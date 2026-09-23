#!/usr/bin/env python3
"""Build script for SysaiQ (bilingual) — two flavours from one template.

Input: src/vesper.src.html (readable template with {{KEY}} content tokens,
<!--SLOT:NAME-->…<!--/SLOT:NAME--> markers, a CDN script tag and a
__LANDMASK_B64__ placeholder) plus src/content.py (STRINGS + META).

Output 1 — baked (unchanged behaviour, nginx fallback while Node is down):
  en/index.html   English page, LTR — fully self-contained
  fa/index.html   Persian page, RTL — Vazirmatn font inlined as well
  index.html      root language redirector (saved choice, else Persian)
  Slot markers are stripped, the inner markup stays.

Output 2 — runtime (what the Node renderer fills from the database):
  server/templates/home.en.html, home.fa.html
      plumbing tokens resolved, assets referenced as /assets/…, every slot
      region collapsed to {{SLOT_NAME}}, content tokens with source "token"
      left in place ({{KEY}}: "plain" → esc(), "inline" → renderInline()).
  server/templates/content-defaults.json
      every key: {en, fa, type, group, label_fa, label_en, max, anchor,
      order, source} — defaults converted to the lib/inline.js mini-markup.
  server/templates/manifest.json
      template_sha, tokens, slots, asset URLs and the sha256 CSP hashes of
      every inline <script> (runtime "home" pages and the baked pages).
      `scripts` (top level) repeats csp.home.en — the shape lib/csp.js reads
      today for the /fa/ and /en/ script-src; csp.home/csp.baked stay the
      documented per-flavour tree.

Everything is deterministic (no timestamps): same input → same bytes.
A missing key, a leftover token or a malformed slot fails the build loudly.

Usage:  python3 build.py [--site-dir DIR] [--templates-dir DIR]
"""
import argparse
import base64
import hashlib
import html
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC_PATH = ROOT / "src" / "vesper.src.html"
CDN_TAG = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/'
           'three.js/r128/three.min.js"></script>')
RUNTIME_BANNER = "<!-- sysaiq runtime template; do not edit -->\n"

# slot names in template order; the renderer fills {{SLOT_<name>}}
SLOTS = [
    "HEAD_META", "JSONLD", "NAV_EXTRA", "SECTIONS_AFTER_ABOUT", "WORK",
    "SECTIONS_AFTER_WORK", "NEWS", "FAQ", "NEWS_FEED", "SECTIONS_AFTER_FAQ",
    "CONTACT", "FOOTER_LINKS", "FOOTER_TRUST", "SITE_DATA",
]
# tokens that are not copy: resolved by this script in both flavours
PLUMBING = [
    "HTML_ATTRS", "CANONICAL", "ALT_FA", "ALT_EN", "OG_LOCALE", "SW_FA_ON",
    "SW_EN_ON", "LANG", "FONT_CSS", "FONT_PRELOAD", "LOGO_MARK_URI", "FAVICON_URI",
]
SOURCES = ("token", "slot:WORK", "slot:FAQ", "slot:CONTACT", "slot:SITE_DATA")

TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
MARK_RE = re.compile(r"<!--(/?)SLOT:([A-Z_]+)-->")
# a line that holds nothing but slot markers (baked: dropped whole, so the
# output is byte-identical to a template without markers)
MARK_LINE_RE = re.compile(r"^[ \t]*(?:<!--/?SLOT:[A-Z_]+-->[ \t]*)+\n", re.M)
REGION_RE = re.compile(r"<!--SLOT:([A-Z_]+)-->.*?<!--/SLOT:\1-->", re.S)
SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S)
MARKUP_RE = re.compile(r"<br>|</?em>|&[a-zA-Z]+;|&#\d+;")


def fail(msg):
    print(f"build.py: {msg}", file=sys.stderr)
    sys.exit(1)


def check(cond, msg):
    if not cond:
        fail(msg)


def sha256_b64(text):
    return "sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode()


def data_uri(path, mime):
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def json_str(s):
    """JSON string body (no quotes) safe inside <script type="application/json">."""
    return (json.dumps(s, ensure_ascii=False)[1:-1]
            .replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def to_markup(s):
    """Template HTML (<br>, <em>, entities) → lib/inline.js mini-markup."""
    s = s.replace("<br>", "\n")
    s = re.sub(r"<em>(.*?)</em>", r"*\1*", s)
    return html.unescape(s)


def font_css(src):
    return f"""  @font-face{{
    font-family:'Vazirmatn';
    src:url({src}) format('woff2-variations');
    font-weight:100 900;font-display:swap;
  }}
  [dir="rtl"] body{{font-family:Vazirmatn,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;}}
"""


# ---- content model ------------------------------------------------------
def load_content():
    spec = importlib.util.spec_from_file_location("content", ROOT / "src" / "content.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def validate_meta(STRINGS, META, GROUPS, ATTR_KEYS):
    missing, extra = set(STRINGS) - set(META), set(META) - set(STRINGS)
    check(not missing and not extra, f"STRINGS/META drift: missing META {sorted(missing)}, extra META {sorted(extra)}")
    for key, m in META.items():
        v = STRINGS[key]
        check(set(v) == {"en", "fa"} and all(isinstance(v[l], str) and v[l].strip() for l in v),
              f"{key}: needs non-empty en + fa")
        check(m["type"] in ("plain", "inline"), f"{key}: type must be plain|inline")
        check(m["group"] in GROUPS, f"{key}: unknown group {m['group']!r}")
        check(m["label_fa"].strip() and m["label_en"].strip(), f"{key}: labels required")
        check(isinstance(m["max"], int) and m["max"] > 0, f"{key}: max must be a positive int")
        check(m["anchor"].startswith("#"), f"{key}: anchor must be #section-id")
        check(m["source"] in SOURCES, f"{key}: bad source {m['source']!r}")
        has_markup = any(MARKUP_RE.search(v[l]) for l in v)
        if key in ATTR_KEYS:
            check(m["type"] == "plain" and not has_markup, f"{key}: attribute keys must be plain, no markup")
        else:
            want = "inline" if has_markup else "plain"
            check(m["type"] == want, f"{key}: type must be {want!r} (markup in default: {has_markup})")
        for l in v:
            d = to_markup(v[l])
            check("<" not in d and ">" not in d, f"{key}.{l}: unsupported markup in default")
            check(len(d) <= m["max"], f"{key}.{l}: default ({len(d)}) longer than max ({m['max']})")
            if m["type"] == "inline":
                # only markup the mini-markup renderer will reproduce faithfully
                check(not re.search(r"[`\[\\]", d), f"{key}.{l}: ` [ \\ are not allowed in inline defaults")
                check(d.count("*") == 2 * v[l].count("<em>"), f"{key}.{l}: stray * in inline default")
    seen = []
    for m in META.values():
        if m["group"] not in seen:
            seen.append(m["group"])
    check(seen == GROUPS, f"META groups out of page order: {seen}")
    orders = [m["order"] for m in META.values()]
    check(orders == sorted(orders) and len(set(orders)) == len(orders), "META order must be strictly increasing")


# ---- template checks ----------------------------------------------------
def check_markers(src):
    """Every slot opened once, closed once, not nested, in SLOTS order."""
    order, stack = [], []
    for m in MARK_RE.finditer(src):
        closing, name = m.group(1) == "/", m.group(2)
        if closing:
            check(stack == [name], f"marker </SLOT:{name}> without a matching open marker")
            stack.pop()
        else:
            check(not stack, f"nested slot marker {name} inside {stack}")
            check(name not in order, f"slot {name} marked twice")
            stack.append(name)
            order.append(name)
    check(not stack, f"unclosed slot marker {stack}")
    check(order == SLOTS, f"slots in template {order} != expected {SLOTS}")


def check_sources(src, META):
    """META.source must say where the token really sits: inside the named
    slot region ("slot:X") or outside every region ("token")."""
    regions = {m.group(1): (m.start(), m.end()) for m in REGION_RE.finditer(src)}
    for key, m in META.items():
        inside = set()
        for t in re.finditer(r"\{\{" + key + r"\}\}", src):
            for name, (a, b) in regions.items():
                if a <= t.start() < b:
                    inside.add(name)
        want = "token" if not inside else ("slot:" + inside.pop() if len(inside) == 1 else None)
        check(want is not None, f"{key}: used in several slot regions")
        check(m["source"] == want, f"{key}: META source is {m['source']!r} but the template says {want!r}")


def main_script(page):
    """The hashed page script (the one carrying the particle engine)."""
    bodies = [body for attrs, body in SCRIPT_RE.findall(page)
              if "src=" not in attrs and "json" not in attrs and "VESPER" in body]
    check(len(bodies) == 1, "expected exactly one main inline script")
    return bodies[0]


def inline_script_hashes(page):
    """sha256 of every inline <script> that executes (no src, not a JSON block)."""
    out = []
    for attrs, body in SCRIPT_RE.findall(page):
        if re.search(r"\bsrc\s*=", attrs):
            continue
        t = re.search(r'type\s*=\s*"([^"]*)"', attrs)
        if t and "json" in t.group(1):
            continue
        out.append(sha256_b64(body))
    return out


# ---- flavours -----------------------------------------------------------
def substitute(out, STRINGS, META, lang, keys):
    for key in keys:
        token = "{{" + key + "}}"
        check(token in out, f"token {token} missing from template")
        val = STRINGS[key][lang]
        if META[key]["source"] == "slot:SITE_DATA":
            val = json_str(val)  # lands inside the #site-data JSON block
        out = out.replace(token, val)
    return out


def plumbing(out, lang, cfg, assets):
    rep = {
        "HTML_ATTRS": cfg["html_attrs"], "CANONICAL": cfg["canonical"],
        "ALT_FA": cfg["alt_fa"], "ALT_EN": cfg["alt_en"], "OG_LOCALE": cfg["og_locale"],
        "SW_FA_ON": 'class="on"' if lang == "fa" else "",
        "SW_EN_ON": 'class="on"' if lang == "en" else "",
        "LANG": lang,
        "FONT_CSS": font_css(assets["font"]) if lang == "fa" else "",
        "FONT_PRELOAD": (f'\n<link rel="preload" href="{assets["font"]}" as="font" type="font/woff2" crossorigin>'
                         if lang == "fa" and assets["preload"] else ""),
        "LOGO_MARK_URI": assets["logo"], "FAVICON_URI": assets["favicon"],
    }
    assert set(rep) == set(PLUMBING)
    for k, v in rep.items():
        out = out.replace("{{" + k + "}}", v)
    return out


def build_baked(src, lang, cfg, C, files):
    out = substitute(src, C.STRINGS, C.META, lang, list(C.STRINGS))
    out = plumbing(out, lang, cfg, {
        "font": "data:font/woff2;base64," + files["font_b64"], "preload": False,
        "logo": files["logo_uri"], "favicon": files["favicon_uri"],
    })
    out = MARK_LINE_RE.sub("", out)          # marker-only lines vanish entirely
    out = MARK_RE.sub("", out)               # (defensive) inline markers
    leftovers = TOKEN_RE.findall(out)
    check(not leftovers, f"{lang} baked: unresolved tokens {sorted(set(leftovers))}")
    out = out.replace("__LANDMASK_B64__", files["mask"])
    check(out.count(CDN_TAG) == 1, "three.js CDN tag missing from source")
    return out.replace(CDN_TAG, "<script>\n" + files["three"] + "\n</script>")


def build_runtime(src, lang, cfg, C, files, token_keys):
    out = REGION_RE.sub(lambda m: "{{SLOT_" + m.group(1) + "}}", src)
    check("SLOT:" not in out, f"{lang} runtime: a slot marker survived")
    out = plumbing(out, lang, cfg, {
        "font": "/assets/vazirmatn-var.woff2", "preload": True,
        "logo": "/assets/logo-mark-160.png", "favicon": "/assets/favicon-64.png",
    })
    out = out.replace("../assets/", "/assets/")
    out = out.replace('href="../fa/"', 'href="/fa/"').replace('href="../en/"', 'href="/en/"')
    check("../" not in out, f"{lang} runtime: relative path left over")
    out = out.replace("__LANDMASK_B64__", files["mask"])
    check(out.count(CDN_TAG) == 1, "three.js CDN tag missing from source")
    out = out.replace(CDN_TAG, f'<script src="{files["three_url"]}"></script>')
    remaining = set(TOKEN_RE.findall(out))
    expected = set(token_keys) | {"SLOT_" + s for s in SLOTS}
    check(remaining == expected,
          f"{lang} runtime: token set mismatch — unexpected {sorted(remaining - expected)}, "
          f"missing {sorted(expected - remaining)}")
    for s in SLOTS:
        check(out.count("{{SLOT_" + s + "}}") == 1, f"{lang} runtime: slot {s} must appear exactly once")
    return RUNTIME_BANNER + out


# ---- root redirector: saved choice > Persian (the site's primary language) ----
# Visitors land on /fa/ unless they explicitly picked EN with the switcher before.
REDIRECT = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SysAIQ</title>
<link rel="alternate" hreflang="fa" href="https://sysaiq.com/fa/">
<link rel="alternate" hreflang="en" href="https://sysaiq.com/en/">
<script>
(function(){
  var lang;
  try{lang=localStorage.getItem('sysaiq-lang');}catch(e){}
  if(lang!=='fa'&&lang!=='en'){lang='fa';}
  location.replace('./'+lang+'/'+location.hash);
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=./fa/"></noscript>
<style>body{background:#050507;color:#eceaf6;font-family:sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
a{color:#7dffd9;text-decoration:none;margin:0 12px;}</style>
</head>
<body><p><a href="./fa/">فارسی</a> · <a href="./en/">English</a></p></body>
</html>
"""


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"built {path} ({len(text.encode('utf-8')):,} bytes)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site-dir", type=Path, default=ROOT, help="where en/ fa/ index.html go (default: repo dir)")
    ap.add_argument("--templates-dir", type=Path, default=ROOT.parent / "server" / "templates",
                    help="where the runtime templates + json go (default: ../server/templates)")
    args = ap.parse_args()

    C = load_content()
    validate_meta(C.STRINGS, C.META, C.GROUPS, C.ATTR_KEYS)
    token_keys = [k for k, m in C.META.items() if m["source"] == "token"]

    src_bytes = SRC_PATH.read_bytes()
    src = src_bytes.decode("utf-8")
    check("__LANDMASK_B64__" in src, "land-mask placeholder missing from source")
    check(src.count(CDN_TAG) == 1, "three.js CDN tag missing from source")
    check("{{" not in main_script(src), "the main script must not contain {{tokens}} (CSP hash)")
    check_markers(src)
    check_sources(src, C.META)
    tokens_in_src = set(TOKEN_RE.findall(src))
    check(tokens_in_src == set(C.STRINGS) | set(PLUMBING),
          f"template/content drift — only in template: {sorted(tokens_in_src - set(C.STRINGS) - set(PLUMBING))}, "
          f"only in content: {sorted(set(C.STRINGS) - tokens_in_src)}")

    three_bytes = (ROOT / "assets" / "three.min.js").read_bytes()
    files = {
        "three": three_bytes.decode("utf-8"),
        "three_url": "/assets/three.min.js?v=" + hashlib.sha256(three_bytes).hexdigest()[:8],
        "mask": (ROOT / "assets" / "landmask.b64").read_text(encoding="utf-8").strip(),
        "font_b64": base64.b64encode((ROOT / "assets" / "vazirmatn-var.woff2").read_bytes()).decode(),
        "logo_uri": data_uri(ROOT / "assets" / "logo-mark-160.png", "image/png"),
        "favicon_uri": data_uri(ROOT / "assets" / "favicon-64.png", "image/png"),
    }

    baked, runtime = {}, {}
    for lang, cfg in C.LANGS.items():
        baked[lang] = build_baked(src, lang, cfg, C, files)
        runtime[lang] = build_runtime(src, lang, cfg, C, files, token_keys)

    # the main script must be one and the same everywhere (one CSP hash)
    scripts = {main_script(p) for p in [*baked.values(), *runtime.values()]}
    check(len(scripts) == 1, "main script differs between languages/flavours")

    for lang in C.LANGS:
        write(args.site_dir / lang / "index.html", baked[lang])
        write(args.templates_dir / f"home.{lang}.html", runtime[lang])
    write(args.site_dir / "index.html", REDIRECT)

    defaults = {}
    for key, m in C.META.items():
        defaults[key] = {
            "en": to_markup(C.STRINGS[key]["en"]), "fa": to_markup(C.STRINGS[key]["fa"]),
            "type": m["type"], "group": m["group"], "label_fa": m["label_fa"], "label_en": m["label_en"],
            "max": m["max"], "anchor": m["anchor"], "order": m["order"], "source": m["source"],
        }
    write(args.templates_dir / "content-defaults.json", json.dumps(defaults, ensure_ascii=False, indent=2) + "\n")

    home_hashes = {lang: inline_script_hashes(runtime[lang]) for lang in C.LANGS}
    check(home_hashes["en"] == home_hashes["fa"] and len(home_hashes["en"]) == 1,
          "runtime pages must carry exactly one identical inline script")
    manifest = {
        "template_sha": hashlib.sha256(src_bytes).hexdigest(),
        "generated_from": "build.py",
        "tokens": token_keys,
        "slots": SLOTS,
        "assets": {"three": files["three_url"]},
        # what server/src/lib/csp.js consumes ({scripts:[sha256-…]}); one hash,
        # identical for en/fa, so the language-agnostic key loses nothing
        "scripts": home_hashes["en"],
        "csp": {
            "home": {lang: home_hashes[lang] for lang in ("en", "fa")},
            "baked": {**{lang: inline_script_hashes(baked[lang]) for lang in ("en", "fa")},
                      "root": inline_script_hashes(REDIRECT)},
        },
    }
    write(args.templates_dir / "manifest.json", json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
