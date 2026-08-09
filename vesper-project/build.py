#!/usr/bin/env python3
"""Build script for SysAIQ (bilingual).

Takes src/vesper.src.html (readable template with {{KEY}} content tokens,
a CDN script tag and a __LANDMASK_B64__ placeholder) plus src/content.py
(bilingual content model) and produces:

  en/index.html   — English page, LTR
  fa/index.html   — Persian page, RTL, Vazirmatn font inlined
  index.html      — tiny language detector/redirector at the root

Each page is fully self-contained (three.js, land mask and — for fa —
the Persian font are inlined), so everything works offline.

Usage:  python3 build.py
"""
import base64
import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).parent
CDN_TAG = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/'
           'three.js/r128/three.min.js"></script>')

# ---- load the bilingual content model ----
spec = importlib.util.spec_from_file_location("content", ROOT / "src" / "content.py")
content = importlib.util.module_from_spec(spec)
spec.loader.exec_module(content)
STRINGS, LANGS = content.STRINGS, content.LANGS

src = (ROOT / "src" / "vesper.src.html").read_text()
three = (ROOT / "assets" / "three.min.js").read_text()
mask = (ROOT / "assets" / "landmask.b64").read_text().strip()
vazir_b64 = base64.b64encode(
    (ROOT / "assets" / "vazirmatn-var.woff2").read_bytes()).decode()


def data_uri(path, mime):
    return f"data:{mime};base64," + base64.b64encode(
        (ROOT / path).read_bytes()).decode()


LOGO_MARK = data_uri("assets/logo-mark-160.png", "image/png")
FAVICON = data_uri("assets/favicon-64.png", "image/png")
ABOUT_ART = data_uri("assets/about-art.jpg", "image/jpeg")

assert "__LANDMASK_B64__" in src, "land-mask placeholder missing from source"
assert CDN_TAG in src, "three.js CDN tag missing from source"

FA_FONT_CSS = f"""  @font-face{{
    font-family:'Vazirmatn';
    src:url(data:font/woff2;base64,{vazir_b64}) format('woff2-variations');
    font-weight:100 900;font-display:swap;
  }}
  [dir="rtl"] body{{font-family:Vazirmatn,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;}}
"""

for lang, cfg in LANGS.items():
    out = src

    # content tokens — every key must exist in the template
    for key, vals in STRINGS.items():
        token = "{{" + key + "}}"
        assert token in out, f"token {token} missing from template"
        out = out.replace(token, vals[lang])

    # plumbing tokens
    out = out.replace("{{HTML_ATTRS}}", cfg["html_attrs"])
    out = out.replace("{{CANONICAL}}", cfg["canonical"])
    out = out.replace("{{ALT_FA}}", cfg["alt_fa"])
    out = out.replace("{{ALT_EN}}", cfg["alt_en"])
    out = out.replace("{{OG_LOCALE}}", cfg["og_locale"])
    out = out.replace("{{SW_FA_ON}}", 'class="on"' if lang == "fa" else "")
    out = out.replace("{{SW_EN_ON}}", 'class="on"' if lang == "en" else "")
    out = out.replace("{{FONT_CSS}}", FA_FONT_CSS if lang == "fa" else "")
    out = out.replace("{{LOGO_MARK_URI}}", LOGO_MARK)
    out = out.replace("{{FAVICON_URI}}", FAVICON)
    out = out.replace("{{ABOUT_ART_URI}}", ABOUT_ART)

    leftovers = re.findall(r"\{\{[A-Z0-9_]+\}\}", out)
    assert not leftovers, f"unresolved tokens: {leftovers}"

    # inline assets
    out = out.replace("__LANDMASK_B64__", mask)
    out = out.replace(CDN_TAG, "<script>\n" + three + "\n</script>")

    dest = ROOT / lang / "index.html"
    dest.parent.mkdir(exist_ok=True)
    dest.write_text(out)
    print(f"built {lang}/index.html ({len(out):,} bytes)")

# ---- root redirector: saved choice > browser language > English ----
REDIRECT = """<!DOCTYPE html>
<html lang="en">
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
  if(lang!=='fa'&&lang!=='en'){
    lang=(navigator.language||'').toLowerCase().indexOf('fa')===0?'fa':'en';
  }
  location.replace('./'+lang+'/'+location.hash);
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=./en/"></noscript>
<style>body{background:#050507;color:#eceaf6;font-family:sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
a{color:#7dffd9;text-decoration:none;margin:0 12px;}</style>
</head>
<body><p><a href="./fa/">فارسی</a> · <a href="./en/">English</a></p></body>
</html>
"""
(ROOT / "index.html").write_text(REDIRECT)
print("built index.html (language redirector)")
