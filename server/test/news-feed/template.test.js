// The NEWS_FEED slot in the build contract: one empty marker pair right
// after the FAQ region, {{SLOT_NEWS_FEED}} exactly once in each runtime
// template (between {{SLOT_FAQ}} and {{SLOT_SECTIONS_AFTER_FAQ}}), and the
// baked fallback pages byte-identical to a build without the marker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VESPER = join(REPO, 'vesper-project');
const read = p => readFileSync(join(REPO, p), 'utf8');
const MARKER = '<!--SLOT:NEWS_FEED--><!--/SLOT:NEWS_FEED-->';

test('source template: one empty NEWS_FEED marker pair right after the FAQ region', () => {
  const src = read('vesper-project/src/vesper.src.html');
  assert.equal(src.split(MARKER).length - 1, 1);
  assert.ok(src.includes(`<!--/SLOT:FAQ-->\n${MARKER}\n<!--SLOT:SECTIONS_AFTER_FAQ-->`));
  assert.match(read('vesper-project/build.py'), /"FAQ", "NEWS_FEED", "SECTIONS_AFTER_FAQ"/);
});

test('runtime templates: {{SLOT_NEWS_FEED}} once, between the FAQ and the after-FAQ sections', () => {
  for (const lang of ['fa', 'en']) {
    const html = read(`server/templates/home.${lang}.html`);
    assert.equal(html.split('{{SLOT_NEWS_FEED}}').length - 1, 1, lang);
    assert.ok(html.includes('{{SLOT_FAQ}}\n{{SLOT_NEWS_FEED}}\n{{SLOT_SECTIONS_AFTER_FAQ}}'), lang);
  }
  const { slots } = JSON.parse(read('server/templates/manifest.json'));
  assert.equal(slots.indexOf('NEWS_FEED'), slots.indexOf('FAQ') + 1);
  assert.equal(slots.indexOf('SECTIONS_AFTER_FAQ'), slots.indexOf('NEWS_FEED') + 1);
  // the renderer finds the module by the slot name
  assert.ok(readFileSync(join(REPO, 'server', 'src', 'render', 'slots', 'news_feed.js'), 'utf8').includes('export function renderSlot(lang)'));
});

test('baked pages: no residue, and byte-identical to a build without the marker', t => {
  for (const lang of ['fa', 'en']) {
    const html = read(`vesper-project/${lang}/index.html`);
    assert.ok(!html.includes('SLOT:') && !html.includes('{{SLOT_') && !html.includes('news-feed'), lang);
  }
  // build the current source and the source minus the marker line into scratch dirs
  const scratch = mkdtempSync(join(tmpdir(), 'sysaiq-nf-'));
  try {
    const copy = join(scratch, 'vesper');
    mkdirSync(join(copy, 'assets'), { recursive: true });
    cpSync(join(VESPER, 'build.py'), join(copy, 'build.py'));
    cpSync(join(VESPER, 'src'), join(copy, 'src'), { recursive: true });
    for (const f of ['three.min.js', 'landmask.b64', 'vazirmatn-var.woff2', 'logo-mark-160.png', 'favicon-64.png']) cpSync(join(VESPER, 'assets', f), join(copy, 'assets', f));
    const build = out => spawnSync('python3', ['build.py', '--site-dir', join(scratch, out, 'site'), '--templates-dir', join(scratch, out, 'tpl')], { cwd: copy, encoding: 'utf8' });
    let r = build('with');
    if (r.error?.code === 'ENOENT') { t.skip('python3 not found'); return; }
    assert.equal(r.status, 0, r.stderr);
    const srcPath = join(copy, 'src', 'vesper.src.html');
    writeFileSync(srcPath, readFileSync(srcPath, 'utf8').replace(`${MARKER}\n`, ''));
    // build.py insists on its SLOTS order, so drop the name there too
    const py = join(copy, 'build.py');
    writeFileSync(py, readFileSync(py, 'utf8').replace('"NEWS_FEED", ', ''));
    r = build('without');
    assert.equal(r.status, 0, r.stderr);
    for (const lang of ['fa', 'en']) {
      const a = readFileSync(join(scratch, 'with', 'site', lang, 'index.html'));
      const b = readFileSync(join(scratch, 'without', 'site', lang, 'index.html'));
      assert.ok(a.equals(b), `${lang}: the empty marker changes nothing in the baked page`);
      assert.ok(a.equals(readFileSync(join(VESPER, lang, 'index.html'))), `${lang}: committed baked page is up to date`);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
