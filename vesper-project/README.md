# SysAIQ.com — bilingual landing

A dark, living landing page for SysAIQ (AI & software systems lab):
one field of 91,000 particles that breathes as an orb, blows open into a
ring galaxy, gathers into the Earth with real coastlines, and finally
aligns into the word "SysAIQ" — driven by scroll, answering every move
of the cursor. Fully bilingual: Persian (RTL, Vazirmatn) and English.

## Quick start

Serve the folder and open `/en/` or `/fa/` — or open `index.html`, which
redirects to the visitor's language:

```bash
python3 -m http.server
```

Every built page is self-contained (three.js, Earth land mask and the
Persian font are inlined), so it also works offline.

## Editing

1. Copy lives in `src/content.py` (`en` / `fa` side by side).
   Layout/behaviour lives in `src/vesper.src.html`.
2. Rebuild both languages + the root redirector:

   ```bash
   python3 build.py
   ```

Never edit `en/index.html`, `fa/index.html` or the root `index.html` by
hand — they are build output. See `CLAUDE.md` for the full architecture.
