// Image upload → returns a public /uploads URL. The bytes are checked and
// named by lib/upload.js (magic-byte allowlist, extension from the type).
import express from 'express';
import { uploadImage, storeImage } from '../../lib/upload.js';

const router = express.Router();

router.post('/', uploadImage, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const { url } = storeImage(req.file.buffer); // throws HttpError 422 for non-images
  res.json({ ok: true, url });
});

export default { basePath: '/upload', order: 80, router };
