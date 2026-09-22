// HTTP errors with a stable JSON shape: {error, message, fields?}.
// Routes throw HttpError (or return a rejected promise inside asyncHandler);
// errorMiddleware turns anything else into a 500 without leaking internals.

export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }
  toJSON() {
    const out = { error: this.code, message: this.message };
    if (this.fields) out.fields = this.fields;
    return out;
  }
}

// wrap async route handlers so rejections reach errorMiddleware
export const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// eslint-disable-next-line no-unused-vars
export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json(err.toJSON());
  // body-parser / rate-limit style errors carry a status; multer's don't
  const status = Number(err?.status || err?.statusCode) || (err?.name === 'MulterError' ? 400 : 500);
  if (status >= 400 && status < 500) {
    const code = err?.type === 'entity.parse.failed' ? 'bad_json'
      : err?.code === 'LIMIT_FILE_SIZE' ? 'file_too_large'
        : String(err?.code || 'bad_request').toLowerCase();
    // a JSON parse error's message quotes the request body — never echo that back
    const message = code === 'bad_json' ? 'Body is not valid JSON' : (err.message || code);
    return res.status(status).json({ error: code, message });
  }
  // never echo the stack or message of an unexpected error to the client
  console.error(`[${req.method} ${req.originalUrl}]`, err?.stack || err);
  res.status(500).json({ error: 'internal', message: 'Internal server error' });
}
