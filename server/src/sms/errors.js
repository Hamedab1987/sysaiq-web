// One error type for the whole SMS subsystem. Providers map their own
// status codes onto the normalised `code` below; the service decides from
// `retriable` whether the fallback provider gets a turn. Messages are
// bilingual so the admin sees Persian and the log keeps something greppable.
import { HttpError } from '../lib/errors.js';

// code → { fa, en, retriable }. "retriable" means another provider (or a
// later retry) may succeed: outages, rate limits, credit/line problems that
// are specific to one provider account. Bad numbers, our own validation and
// wrong keys are not.
export const ERROR_CODES = Object.freeze({
  network:        { fa: 'اتصال به سرویس‌دهنده برقرار نشد', en: 'Could not reach the provider', retriable: true },
  timeout:        { fa: 'سرویس‌دهنده در زمان مجاز پاسخ نداد', en: 'Provider timed out', retriable: true },
  server_error:   { fa: 'خطای داخلی سرویس‌دهنده', en: 'Provider server error', retriable: true },
  rate_limited:   { fa: 'سرویس‌دهنده درخواست‌ها را محدود کرده است', en: 'Provider rate limit hit', retriable: true },
  no_credit:      { fa: 'اعتبار پنل پیامک کافی نیست', en: 'Insufficient SMS credit', retriable: true },
  line:           { fa: 'خط ارسال نامعتبر یا غیرفعال است', en: 'Sender line invalid or inactive', retriable: true },
  unknown:        { fa: 'خطای نامشخص از سرویس‌دهنده', en: 'Unknown provider error', retriable: true },
  auth:           { fa: 'کلید یا نام کاربری سرویس‌دهنده نادرست است', en: 'Provider credentials rejected', retriable: false },
  disabled:       { fa: 'حساب سرویس‌دهنده غیرفعال است', en: 'Provider account disabled', retriable: false },
  bad_mobile:     { fa: 'شمارهٔ گیرنده نامعتبر است', en: 'Recipient number invalid', retriable: false },
  blacklisted:    { fa: 'شمارهٔ گیرنده در لیست سیاه است', en: 'Recipient is blacklisted', retriable: false },
  template:       { fa: 'الگو در پنل سرویس‌دهنده یافت نشد یا تأیید نشده است', en: 'Pattern not found or not approved', retriable: false },
  validation:     { fa: 'سرویس‌دهنده مقادیر ارسالی را نپذیرفت', en: 'Provider rejected the request values', retriable: false },
  bad_response:   { fa: 'پاسخ سرویس‌دهنده قابل خواندن نبود', en: 'Provider response unreadable', retriable: true },
  unsupported:    { fa: 'این سرویس‌دهنده این قابلیت را پشتیبانی نمی‌کند', en: 'Provider does not support this operation', retriable: false },
  not_configured: { fa: 'سرویس‌دهنده پیکربندی نشده است (کلید یا خط ارسال)', en: 'Provider not configured (key or line)', retriable: false },
  provider_unknown: { fa: 'سرویس‌دهندهٔ ناشناخته', en: 'Unknown provider', retriable: false },
  mock_refused:   { fa: 'سرویس‌دهندهٔ آزمایشی در محیط production مجاز نیست', en: 'Mock provider is refused in production', retriable: false },
  // template rendering
  template_missing: { fa: 'قالب پیامک یافت نشد', en: 'SMS template not found', retriable: false },
  template_disabled: { fa: 'این قالب غیرفعال است', en: 'This template is disabled', retriable: false },
  missing_var:    { fa: 'مقدار یکی از متغیرهای قالب ارسال نشده است', en: 'A template variable is missing', retriable: false },
  too_long:       { fa: 'متن پیامک بیش از حد مجاز بلند است', en: 'Message text is too long', retriable: false },
  empty_text:     { fa: 'متن پیامک خالی است', en: 'Message text is empty', retriable: false },
  // skip reasons stored in sms_log.error_code with status = skipped
  dedupe:         { fa: 'قبلاً برای همین رویداد ارسال شده است', en: 'Already sent for this event', retriable: false },
  cap_daily:      { fa: 'سقف روزانهٔ ارسال پر شده است', en: 'Daily send cap reached', retriable: false },
  cap_number:     { fa: 'سقف روزانهٔ این شماره پر شده است', en: 'Daily cap for this number reached', retriable: false },
  cap_template:   { fa: 'در ۲۴ ساعت گذشته همین پیام به این شماره رفته است', en: 'Same message sent to this number in the last 24h', retriable: false },
});

export class SmsError extends Error {
  constructor(code, { message, provider = '', raw = null, retriable, cause } = {}) {
    const def = ERROR_CODES[code] || ERROR_CODES.unknown;
    super(message || def.en);
    this.name = 'SmsError';
    this.code = ERROR_CODES[code] ? code : 'unknown';
    this.provider = provider;
    this.retriable = typeof retriable === 'boolean' ? retriable : def.retriable;
    this.message_fa = def.fa;
    this.message_en = def.en;
    this.raw = raw;
    if (cause) this.cause = cause;
  }
  // what the admin UI shows: normalised label + the provider's own words (capped)
  get detail() {
    const own = this.message && this.message !== this.message_en ? this.message : '';
    return own ? `${this.message_fa} — ${own.slice(0, 200)}` : this.message_fa;
  }
}

export const errorLabel = (code, lang = 'fa') => (ERROR_CODES[code] || ERROR_CODES.unknown)[lang === 'en' ? 'en' : 'fa'];

// HttpError whose JSON also carries the English text: {error, message(fa), message_en, fields?}
export class SmsHttpError extends HttpError {
  constructor(status, code, fa, en, fields) {
    super(status, code, fa, fields);
    this.message_en = en || fa;
  }
  toJSON() {
    return { ...super.toJSON(), message_en: this.message_en };
  }
}

// Persian-first validation error for the admin routes: fields = {key: fa message}
export const invalid = fields => new SmsHttpError(422, 'validation', 'اطلاعات واردشده معتبر نیست', 'Validation failed', fields);
