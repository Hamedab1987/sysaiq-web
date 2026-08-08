#!/usr/bin/env python3
"""Build script for Vesper.

Takes src/vesper.src.html (readable source with a CDN script tag and a
__LANDMASK_B64__ placeholder) and produces index.html — a single,
fully self-contained file with three.js and the land mask inlined,
so it works offline and inside claude.ai artifacts.

Usage:  python3 build.py
"""
from pathlib import Path

ROOT = Path(__file__).parent
CDN_TAG = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/'
           'three.js/r128/three.min.js"></script>')

src = (ROOT / "src" / "vesper.src.html").read_text()
three = (ROOT / "assets" / "three.min.js").read_text()
mask = (ROOT / "assets" / "landmask.b64").read_text().strip()

assert "__LANDMASK_B64__" in src, "land-mask placeholder missing from source"
assert CDN_TAG in src, "three.js CDN tag missing from source"

out = src.replace("__LANDMASK_B64__", mask)
out = out.replace(CDN_TAG, "<script>\n" + three + "\n</script>")

(ROOT / "index.html").write_text(out)
print(f"built index.html ({len(out):,} bytes)")
