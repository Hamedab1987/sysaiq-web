// Image uploads: multer in memory (8 MB cap), then the bytes decide.
// Only JPEG / PNG / WebP / GIF are accepted, detected from their magic
// bytes — the client's file name and Content-Type are never trusted, and the
// stored extension comes from the detected type. Anything that also looks
// like markup (SVG/HTML/XML, or an image/markup polyglot) is rejected:
// /uploads is served with a sandboxing CSP and nosniff anyway, this just
// keeps the store clean.
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { HttpError } from './errors.js';

const MAX_BYTES = 8 * 1024 * 1024;

const TYPES = [
  { ext: 'jpg', mime: 'image/jpeg', test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { ext: 'gif', mime: 'image/gif', test: b => b.length >= 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') },
  { ext: 'webp', mime: 'image/webp', test: b => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

// byte patterns that have no business inside a raster image
const MARKUP = ['<script', '<svg', '<html', '<!doctype', '<?xml', '<iframe', '<object', '<embed', 'javascript:'];
// Only the head of the file is scanned: that is where EXIF/XMP/HTML
// prefixes live, while deep inside compressed pixel data a 4-byte pattern
// like "<svg" turns up by chance in ~0.4% of ordinary 2 MB JPEGs. The real
// control for /uploads is the sandbox CSP + nosniff, not this scan.
export const SNIFF_BYTES = 64 * 1024;

export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return null;
  const t = TYPES.find(x => x.test(buf));
  if (!t) return null;
  const text = buf.subarray(0, SNIFF_BYTES).toString('latin1').toLowerCase();
  if (MARKUP.some(m => text.includes(m))) return null; // polyglot
  return { ext: t.ext, mime: t.mime };
}

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
}).single('file');

// same naming as before: <timestamp>-<8 hex>.<ext>
export function storeImage(buf) {
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(422, 'unsupported_image', 'Only JPEG, PNG, WebP or GIF images are accepted');
  mkdirSync(config.uploadDir, { recursive: true });
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${kind.ext}`;
  const path = join(config.uploadDir, filename);
  writeFileSync(path, buf, { flag: 'wx' });
  return { filename, path, url: `/uploads/${filename}`, mime: kind.mime, bytes: buf.length };
}
