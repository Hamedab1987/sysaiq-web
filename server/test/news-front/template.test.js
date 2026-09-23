// The NEWS slot in the build contract: one empty marker pair in the source,
// {{SLOT_NEWS}} exactly once in each runtime template (after the sections
// placed after work, before the FAQ), and nothing at all in the baked pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = p => readFileSync(join(REPO, p), 'utf8');

test('source template: one empty NEWS marker pair right after SECTIONS_AFTER_WORK', () => {
  const src = read('vesper-project/src/vesper.src.html');
  assert.equal(src.split('<!--SLOT:NEWS--><!--/SLOT:NEWS-->').length - 1, 1);
  assert.ok(src.includes('<!--SLOT:SECTIONS_AFTER_WORK--><!--/SLOT:SECTIONS_AFTER_WORK-->\n<!--SLOT:NEWS--><!--/SLOT:NEWS-->\n'));
  assert.match(read('vesper-project/build.py'), /"SECTIONS_AFTER_WORK", "NEWS", "FAQ"/);
});

test('runtime templates: {{SLOT_NEWS}} once, between the after-work sections and the FAQ', () => {
  for (const lang of ['fa', 'en']) {
    const html = read(`server/templates/home.${lang}.html`);
    assert.equal(html.split('{{SLOT_NEWS}}').length - 1, 1, lang);
    const [after, news, faq] = ['{{SLOT_SECTIONS_AFTER_WORK}}', '{{SLOT_NEWS}}', '{{SLOT_FAQ}}'].map(s => html.indexOf(s));
    assert.ok(after > 0 && after < news && news < faq, lang);
  }
  const { slots } = JSON.parse(read('server/templates/manifest.json'));
  assert.equal(slots.indexOf('NEWS'), slots.indexOf('SECTIONS_AFTER_WORK') + 1);
});

test('baked pages: no marker or token residue, no news block', () => {
  for (const lang of ['fa', 'en']) {
    const html = read(`vesper-project/${lang}/index.html`);
    assert.ok(!html.includes('SLOT:'), `${lang}: marker left`);
    assert.ok(!html.includes('{{SLOT_'), `${lang}: slot token left`);
    assert.ok(!html.includes('id="news"'), `${lang}: news block baked in`);
  }
});
