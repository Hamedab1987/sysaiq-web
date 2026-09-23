---
name: iran-payment-gateways
description: Verified API contracts and safety rules for Iranian payment gateways (Zarinpal v4, PayPing v3, Zibal v1, SEP/Saman OnlinePG, Vandar v3) used by SysaiQ's invoice + pay-link flow. Read before writing or reviewing anything under server/src/payments.
---

# Iranian payment gateways — contracts (verified 2026-09-22 from official docs/SDKs)

Anything marked **VERIFY** could not be confirmed from docs — confirm it against the
provider's live docs/sandbox before relying on it, and keep the mark in code comments.

**Reachability warning:** from non-Iranian IPs these API hosts often time out
(production server 104.237.232.226 is outside Iran). Every adapter takes an optional
`relay_base` (+ `X-Relay-Key`) so calls can go through the owner's Iranian server.
"Test connection" buttons must run from the server, never from the browser.

| | Zarinpal v4 | PayPing v3 | Zibal v1 | Vandar v3 (phase 2) |
|---|---|---|---|---|
| Create | `POST https://payment.zarinpal.com/pg/v4/payment/request.json` | `POST https://api.payping.ir/v3/pay` | `POST https://gateway.zibal.ir/v1/request` | `POST https://ipg.vandar.io/api/v3/send` |
| Auth | `merchant_id` (36-char UUID) in JSON body | `Authorization: Bearer <token>` | `merchant` in body | `api_key` in body |
| Create fields | `amount`, `description` (≤500), `callback_url`, `currency:"IRR"`, `metadata{mobile,email,order_id}` | `amount`, `returnUrl`, `clientRefId` (required), `payerIdentity`, `payerName`, `description` | `amount`, `callbackUrl`, `orderId?`, `description?`, `mobile?` | `amount`, `callback_url`, `mobile_number?`, `factorNumber?`, `description?` (≤255) |
| **Wire unit** | **Rial** (send `currency:"IRR"` explicitly) | **Toman** | **Rial** | **Rial** |
| Create OK | `data.code==100` → `data.authority` | HTTP 200 → `paymentCode`, `url` | `result==100` → `trackId` | `status==1` → `token` |
| Redirect | `https://payment.zarinpal.com/pg/StartPay/{authority}` | `https://api.payping.ir/v3/pay/start/{paymentCode}` | `https://gateway.zibal.ir/start/{trackId}` | `https://ipg.vandar.io/v3/{token}` |
| Callback | GET `?Authority=…&Status=OK\|NOK` | **POST** form-urlencoded: `status` (1/0), `errorCode`, `data` (JSON: `clientRefId`, `paymentCode`, `paymentRefId`, `amount`, `cardNumber`, `cardHashPan`) | GET `?trackId&success=1\|0&status&orderId` | GET `?token&payment_status=OK\|…` |
| Verify | `POST …/verify.json {merchant_id, amount, authority}` | `POST /v3/pay/verify {paymentRefId, paymentCode, amount}` — **within 10 minutes or the money is auto-refunded** | `POST /v1/verify {merchant, trackId}` | `POST /api/v3/verify {api_key, token}` |
| Success / already verified | `100` / `101` | 200 / HTTP 409 + `metaData.code==110`; 202/502 = still processing → retry verify, never re-charge | `100` / `201` (`202` unpaid, `203` bad trackId) | `status 1` / `2` (`3` expired) |
| Verify returns | `ref_id`, `card_pan`, `card_hash`, `fee` | `paymentRefId`, `cardNumber`, `cardHashPan`, `amount`, `clientRefId` (compare both with DB) | `paidAt`, `cardNumber`, `refNumber`, `amount`, `orderId` | `amount`, `realAmount`, `wage`, `transId`, `cardNumber`, `factorNumber` |
| Inquiry | `…/inquiry.json` → `VERIFIED\|PAID\|IN_BANK\|FAILED\|REVERSED`; `…/unVerified.json` (last 100) | none found | `POST /v1/inquiry` (1 paid+verified, 2 paid+unverified, -1 pending, 3 cancelled) | `POST /api/v3/transaction` |
| Sandbox | host `https://sandbox.zarinpal.com/…`, any UUID merchant; authorities start with `S` | **VERIFY** | `merchant:"zibal"` | not documented |
| Limits / rules | max 100,000,000 Toman (`-41`); `-14` callback domain ≠ registered; `-10` bad IP/merchant; `-50` amount mismatch | **VERIFY** | min 1,000 Rial (`105`); `106` bad callback; `115` unregistered IP | min 1,000 Rial; callback domain pre-registered; IP validation |

Excluded: **IDPay** (Central Bank revoked its licence in 2024; merchants' funds were frozen),
**Sizpay** (SOAP). **NextPay**: docs unreachable — contract unverified, optional phase 2.

## SEP — Saman Electronic Payment (sep.ir), direct Shaparak bank IPG (verified 2026-09-23)
Adapter `server/src/payments/gateways/sep.js` (id `sep`, «سامان (سپ)», secret `gw.sep.terminal_id`).
Source: SEP «راهنمای استفاده از درگاه پرداخت اینترنتی» **v3.3 (Esfand 1402)** — official merchant PDF
(mirror: wp-master.ir/wp-content/uploads/2024/07/SEP_OnlinePG_Merchant-Document_Minimal_Current-3.3.pdf);
cross-checked with shetabit/multipay `src/Drivers/SEP/SEP.php` and farayaz/larapay `src/Gateways/Sep.php`.

| Step | Contract |
|---|---|
| Auth | **TerminalId only** + caller **IP registered with SEP** (token and verify are IP-checked; `8`/`-106` = IP not allowed). Register the IP that actually calls SEP: the server (104.237.232.226) or the Iranian relay. |
| Token | `POST https://sep.shaparak.ir/onlinepg/onlinepg` JSON `{action:"token", TerminalId, Amount (Rial, integer), ResNum (ours, unique), RedirectUrl, CellNumber?}` (+ optional `TokenExpiryInMin`, `Wage`, `ResNum1-4`, `HashedCardNumber`; doc says send nothing else, names are case-sensitive) → `{status:1, token}` or `{status:-1, errorCode, errorDesc}` |
| Redirect | **GET `https://sep.shaparak.ir/OnlinePG/SendToken?token=…`** (doc v2+; we use it — fits fetch→location.assign and the no-JS 303). Alternative: POST form to `…/OnlinePG/OnlinePG` with `Token` (+`GetMethod`) — not used, would need a JS/button page. |
| Callback | **POST form-urlencoded** to RedirectUrl (GET only with `GetMethod=true`, impossible via SendToken): `Token, MID, TerminalId, State, Status, RRN/Rrn, RefNum, ResNum, TraceNo, Amount, Wage, AffectiveAmount?, SecurePan (masked), HashedCardNumber (SHA256)` |
| Status | `2 OK` success · `1 CanceledByUser` · `3 Failed` · `4 SessionIsNull` · `5 InvalidParameters` · `8 MerchantIpAddressIsInvalid` · `10 TokenNotFound` · `11 TokenRequired` · `12 TerminalNotFound` · `21 MultisettlePolicyErrors` (same codes as token `errorCode`). Empty RefNum = failed. We require `Status=2` AND `State` OK/empty AND a RefNum. |
| Verify | `POST https://sep.shaparak.ir/verifyTxnRandomSessionkey/ipg/VerifyTransaction` JSON `{RefNum, TerminalNumber (Int64)}` → `{ResultCode, ResultDescription, Success, TransactionDetail:{RRN, RefNum, MaskedPan, HashedPan, TerminalNumber, OrginalAmount, AffectiveAmount, StraceDate, StraceNo}}` (sic `OrginalAmount`) |
| ResultCode | `0` ok · **`2` duplicate request = already verified** · `5` reversed · `-2` not found · `-6` > 30 min (auto-reversed) · `-104` terminal disabled · `-105` terminal unknown · `-106` IP not allowed |
| Window | **Verify within 30 minutes** or SEP reverses the payment to the card. No answer ⇒ retry within the 30 min (reconcile does). |
| Reverse | `POST …/ipg/ReverseTransaction {RefNum, TerminalNumber}`, same response/codes; only after verify, short window (**VERIFY**: digit garbled in PDF, ~50 min). Implemented as `reverse()`, not wired to UI. |
| Inquiry / test | No inquiry endpoint in the doc (reconcile verifies with the stored RefNum; no RefNum ⇒ stays pending until the 45-min expiry). `test()` = read-only verify of an impossible RefNum: `-2` ⇒ terminal + IP accepted; `-104/-105/-106` ⇒ explained. Never a token request. |
| Sandbox | **None.** Full test = one real 1,000-Toman payment. Reports: report.sep.ir (MID + password from SEP support). |

**SEP-specific safety (why the adapter/service look like this):**
- Verify takes **no amount** and echoes **no ResNum**, and SEP **re-confirms the same RefNum on every call**
  (the doc puts double-spend prevention on the merchant). So: `TransactionDetail.OrginalAmount` (and
  `AffectiveAmount`) are **mandatory** and compared exactly in Rial — missing ⇒ not ok; mismatch ⇒ orphaned.
  And the service records `ref_id` right after any successful verify and refuses a ref already held by another
  payment of the same gateway ⇒ `orphaned / duplicate_ref` (otherwise a receipt from a paid invoice could pay
  another same-amount invoice).
- Callback `ResNum`, `Amount`, `TerminalId` that disagree with our payment ⇒ we do **not** call verify, so SEP
  auto-reverses within 30 min (no manual refund).
- `refId` = RefNum (unique digital receipt). RRN / StraceNo stay in `raw_verify` for support; PAN/hash go only
  to `card_pan` / `card_hash`.

**VERIFY AT IMPLEMENTATION** (not settled by the doc): token / RefNum formats and lengths (regexes in sep.js);
whether code `2` carries `TransactionDetail` (if not, the payment is reported failed «check the SEP panel»);
`CellNumber` format (doc sample `9120000000`, we send `09…`); no documented min amount (we use 1,000 Toman);
Shaparak per-transaction caps; whether the site **domain** must also be registered (doc only requires the IP);
Node TLS to sep.shaparak.ir — PHP clients set `DEFAULT@SECLEVEL=1`, so `lib/http.js` (Foundation) may need a
cipher option if the handshake fails; shaparak hosts may refuse non-Iranian IPs ⇒ use the relay.

## Adapter interface (`server/src/payments/gateways/<id>.js`)
```js
// ctx = { config, secret(name), fetch, relay, log }
export default {
  id, label_fa, label_en, wireUnit: 'IRR'|'IRT', minToman, maxToman,
  callbackMethod: 'GET'|'POST',
  redirectOrigins: ['https://payment.zarinpal.com'],     // CSP form-action + redirect allowlist
  configFields: [{ key, label_fa, type: 'text'|'secret'|'boolean', required, pattern, help_fa }],
  async create(ctx, { amountToman, callbackUrl, description, mobile, email, orderId, payerName }),
      // → { authority, redirectUrl, feeToman?, raw }
  parseCallback({ query, body }),                         // pure → { authority, outcome:'ok'|'failed'|'cancelled', extra }
  async verify(ctx, { authority, amountToman, orderId, extra }),
      // → { ok, pending, alreadyVerified, refId, cardPan, cardHash, amountToman?, orderIdEcho?, feeToman?, code, message, raw }
  async inquire?(ctx, { authority }),                     // → { state:'paid_unverified'|'verified'|'pending'|'failed'|'reversed'|'unknown', raw }
  async test(ctx),                                        // read-only credential/connectivity check → { ok, message_fa }
};
```
`mock` gateway (registered only when `NODE_ENV !== 'production'`; the registry refuses it
in production): `redirectUrl` → `/api/pay/mock/bank?authority=M…`, a fake bank page with
«پرداخت موفق / ناموفق / انصراف».

## Non-negotiable payment safety rules
1. Amounts are **integer Toman** in the DB. `toWire(amountToman, unit)` is the ONLY place
   that multiplies by 10; one unit test per adapter asserts the wire amount.
2. The amount verified is `payments.amount_toman` (snapshot at start) — never a query/body value.
3. Payments are located by our own `pid` in the callback URL, cross-checked against the
   stored `authority` and the `:gateway` path segment.
4. Atomic claim before verifying: `UPDATE payments SET status='verifying' … WHERE id=? AND
   status IN ('initiated','pending')` — `changes!==1` ⇒ someone else is handling it; if the
   row is already `succeeded`, render success without re-verifying (replayed callbacks).
   A `verifying` row older than 60 s may be re-claimed (crash recovery).
5. "Already verified" codes (`101`, `201`, `409+110`, status `2`) = success with `already_verified=1`.
6. Where the gateway echoes amount/order id, compare with the DB; mismatch ⇒ `orphaned`, never paid.
7. `markPaid` is ONE `db.transaction`; unique index `ux_pay_one_success (invoice_id) WHERE
   status='succeeded'` is the last line of defence — on violation the payment becomes
   `orphaned` and the owner is alerted to refund manually.
8. Reconcile job every 120 s (`.unref()`): `pending|verifying` older than 2 min → `inquire()`;
   paid-but-unverified → normal verify path; older than 45 min → `expired`.
9. Callback URLs are built from `config.publicBaseUrl`, never the `Host` header. The redirect
   URL is built from constants + a regex-validated authority (Zarinpal `^[AS][0-9A-Za-z]{35}$`);
   ignore gateway-returned URLs or host-allowlist them.
10. The callback router is CSRF-exempt, reads no cookies, accepts only `:gateway` + `pid`,
    and always ends in a 303 to the result page. Success is decided only by the
    server-to-server verify call — `Status=OK` alone never marks anything paid.
11. No card data touches the server; store only the gateway-masked PAN/hash. Raw gateway
    payloads are stored redacted. Never log request bodies or secrets.
12. All pay pages: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`.
13. Max 100M Toman per transaction — larger contracts are split into milestone invoices
    or settled by manual (bank transfer) payment.

Sources: zarinpal.com/docs/paymentGateway · docs.payping.ir (OpenAPI) · help.zibal.ir/ipg ·
vandarpay.github.io/docs/ipg · way2pay.ir/358114 (IDPay licence).
