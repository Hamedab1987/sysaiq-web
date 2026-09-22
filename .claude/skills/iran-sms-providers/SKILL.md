---
name: iran-sms-providers
description: Verified API contracts and sending rules for Iranian SMS providers (Kavenegar, SMS.ir, Ghasedak, IPPanel/Faraz SMS, Melipayamak) used by SysaiQ's SMS panel. Read before writing or reviewing anything under server/src/sms.
---

# Iranian SMS providers — contracts (verified 2026-09-22 from official docs/SDKs)

**VERIFY** = not confirmed from docs; confirm against the provider before relying on it.
API hosts are often unreachable from non-Iranian IPs — adapters accept a `relay_base`
and every provider must be tested from the production server.

| | Kavenegar | SMS.ir | Ghasedak (new API) | IPPanel Edge = Faraz SMS | Melipayamak |
|---|---|---|---|---|---|
| Auth | API key **in the URL path** `https://api.kavenegar.com/v1/{APIKEY}/…` → always `redactUrl` | header `X-API-KEY` | header `ApiKey` | header `Authorization: <apikey>` | `username` + `password` form fields |
| Simple send | `POST sms/send.json` form: `receptor, sender, message` | `POST https://api.sms.ir/v1/send/bulk {lineNumber, messageText, mobiles[]}` | `POST https://gateway.ghasedak.me/rest/api/v1/WebService/SendSingleSMS {lineNumber, receptor, message, clientReferenceId}` | `POST https://edge.ippanel.com/v1/api/send {sending_type:"webservice", from_number:"+98…", message, params:{recipients:["+989…"]}}` | `POST https://rest.payamak-panel.com/api/SendSMS/SendSMS` form: `username, password, to, from, text, isFlash` |
| Pattern send | `POST verify/lookup.json` form: `receptor, template, token, token2, token3` (one recipient per call; `entries` is an object) | `POST /v1/send/verify {mobile, templateId, parameters:[{name,value}]}` — **values ≤ 25 chars** (err 114) | `POST …/SendOtpSMS {receptors:[{mobile, clientReferenceId}], templateName, inputs:[{param,value}]}` | same endpoint `{sending_type:"pattern", from_number, code, recipients:[one E.164], params:{…}}` | `POST …/BaseServiceNumber` form: `username, password, to, bodyId, text` (values joined with `;`) |
| Recipient format | local `09…` | local | local | **E.164 `+989…`** | local |
| Credit | `account/info.json` → `remaincredit` | `GET /v1/credit` → `data` | `GET …/GetAccountInformation` → `Credit` (Rial) | `GET /v1/api/payment/credit/mine` → `data.credit` | `POST …/GetCredit` |
| Delivery status | `sms/status.json` by `messageid` (status table **VERIFY**) | `GET /v1/send/{messageId}` → `deliveryState` 1 delivered, 2 undelivered, 3 at telecom, 4 not reached, 5 reached telecom, 6 error, 7 blacklist | `GET …/CheckSmsStatus?Ids=&Type=1` → 0 none, 1 cancelled, 2 blacklist, 3 to operator, 4 undelivered, 5 delivered, 6 error | "Outbox report by ID" — path **VERIFY** | `POST …/GetDeliveries2 recId` (codes **VERIFY**) |
| Response / errors | `{return:{status,message}, entries}`; 200 OK | `{status,message,data}`: 1 OK, 10/11 bad key, 12 key IP-restricted, 13/14 account disabled, 20 rate-limited, 101 bad line, 102 no credit, 104 bad mobile, 113 template not found, 114 value > 25 chars, 115 blacklisted, 123 line not active | `{IsSuccess, StatusCode, Message, Data}` | `{data, meta:{status, message, message_code}}` (`"200-1"` OK, `"400-1"` auth, `"400-2"` validation) | `{Value, RetStatus, StrRetStatus}` (**VERIFY**) |
| Sandbox | none | sandbox key; only template `123456` | none | none | none |

Kavenegar token rules (no spaces in `token`; `token10`/`token20` allow spaces) and the newer
Melipayamak console token API are **VERIFY**.

## Why patterns are mandatory for automated messages
Operators keep an advertising blacklist; free-text messages from ordinary lines are
silently dropped for subscribers on it. A pre-approved **pattern** goes over the provider's
service route: it reaches blacklisted numbers, is faster, and skips content review.
→ lead confirmation, pay link, payment receipt, reminders and owner alerts use
`sendPattern`. Free-text `send` is only for manual admin sends, with the UI warning
«ممکن است به شماره‌های لیست سیاه تبلیغاتی نرسد». Patterns are created and approved by the
owner in the provider's panel; the DB stores the mapping (`sms_templates.provider_map`).

Because SMS.ir caps variables at 25 chars, the pay link is sent as fixed text
`sysaiq.com/p/` + a 12-char short code variable.

## Adapter interface (`server/src/sms/providers/<id>.js`)
```js
export default {
  id, label_fa, label_en, recipientFormat: 'local'|'e164', supportsPattern, supportsStatus,
  configFields: [{ key, label_fa, type:'text'|'secret', required, help_fa }],
  async send(ctx, { to, text, sender }),             // → { ok, messageId, cost?, raw }
  async sendPattern(ctx, { to, template, params }),  // template = provider_map entry
  async credit(ctx),                                 // → { amount, unit, raw }
  async status?(ctx, { messageId }),                 // → { state:'queued'|'sent'|'delivered'|'undelivered'|'failed'|'blocked'|'unknown', raw }
};
```
`mock` provider (non-production only): writes to `sms_log` + console, fake credit, delivery simulation.

## Service rules
- Dispatcher: provider_map entry for the active provider ⇒ `sendPattern`, else `send`;
  on a retriable error try the configured fallback provider once.
- Dedupe with `sms_log.dedupe_key` (e.g. `payment.succeeded:customer:<payment_id>`).
- Caps: global daily cap; per-number cap 5/day for automated sends; `lead_customer` at most
  1 per number per 24 h (stops the contact form being used to SMS-bomb someone).
- Persian SMS segments: 70 chars single, 67 per part when multipart — show the counter in admin.
- Secrets: `sms.kavenegar.api_key`, `sms.smsir.api_key`, `sms.ghasedak.api_key`,
  `sms.ippanel.api_key`, `sms.melipayamak.password`. Never log URLs for Kavenegar.
- Owner mobile for alerts: `09125130505` (editable in admin).

Default templates (fa): `lead_owner`, `lead_customer`, `invoice_link`, `invoice_reminder`,
`payment_customer`, `payment_owner` — see plan §5.

Sources: sms.ir/rest-api · ghasedak.me/docs · ippanelcom.github.io/Edge-Document ·
github.com/kavenegar/kavenegar-node · github.com/Melipayamak/melipayamak-python.
