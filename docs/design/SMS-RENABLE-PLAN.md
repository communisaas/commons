# SMS / Calling Re-Enablement Plan

**Date**: 2026-03-17
**Status**: Partially implemented — SMS consent model (smsStatus field, blast filter, STOP webhook) DONE. Remaining P0-P2 gaps documented below.

---

## 1. Current State Audit

### What exists and works

The SMS/calling stack is **fully built** — REST client, DB models, CRUD API, UI pages, webhooks, public API, and tests. Nothing was half-finished or stubbed out.

| Layer | Files | Status |
|-------|-------|--------|
| **Twilio REST client** | `src/lib/server/sms/twilio.ts` | Complete. Direct `fetch()` calls, zero SDK. `sendSms`, `initiatePatchThroughCall`, `validateTwilioSignature`, `isValidE164`. |
| **Blast engine** | `src/lib/server/sms/send-blast.ts` | Complete. Batch-of-10 with 1s delay, per-message DB tracking, status rollup. |
| **Type definitions** | `src/lib/server/sms/types.ts` | Complete. Status enums, `SMS_MAX_LENGTH=1600`, `SMS_SEGMENT_LENGTH=160`. |
| **Prisma models** | `prisma/schema.prisma:2043-2122` | Complete. `SmsBlast`, `SmsMessage`, `PatchThroughCall` with full indexes. |
| **Org API** | `src/routes/api/org/[slug]/sms/` | Complete. POST/GET blasts, PATCH/DELETE individual, GET messages. |
| **Org API (calls)** | `src/routes/api/org/[slug]/calls/` | Complete. POST initiate, GET list. |
| **Webhooks** | `src/routes/api/sms/webhook/`, `src/routes/api/sms/call-status/` | Complete. Twilio signature validation, status updates, counter increments. |
| **Public API v1** | `src/routes/api/v1/sms/`, `src/routes/api/v1/calls/` | Complete. API key auth, rate limiting, pagination. |
| **UI pages** | `src/routes/org/[slug]/sms/`, `.../sms/new/`, `.../sms/[id]/`, `.../calls/` | Complete. Blast list, compose, detail+metrics, call log+initiate modal. |
| **Components** | `src/lib/components/sms/` | Complete. `SmsBlastCard`, `CharacterCounter`, `SmsMessageTable`, `CallLogTable`. |
| **Feature flag** | `FEATURES.SMS = true` | Already enabled. |
| **Plan gate** | `orgMeetsPlan(org.id, 'starter')` | Enforced on SMS create + call initiate. Free-tier orgs get 403. |
| **Tests** | `tests/unit/sms/` (4 files) | ~60 tests covering CRUD, webhooks, Twilio integration, patch-through calls. |

### What is NOT wired

The implementation is code-complete but **not operationally live** because:

1. **No Twilio credentials**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` are listed in `.env.example` but not set in production (Cloudflare Pages secrets).
2. **No nav links**: The org sidebar/navigation does not link to `/org/[slug]/sms` or `/org/[slug]/calls`. The pages exist but are unreachable unless someone types the URL.
3. **No SMS consent model**: Supporters have no `smsConsent` or `phoneStatus` field. The blast engine filters on `emailStatus: 'subscribed'` as a proxy — this conflates email opt-out with SMS opt-out.
4. **No STOP/opt-out handling**: There is no inbound webhook to process `STOP` replies. Twilio handles carrier-level STOP automatically, but the app has no way to mark a supporter as SMS-unsubscribed.
5. **No SMS usage tracking in billing**: `getOrgUsage` counts verified actions and emails. SMS sends are not counted, and `PlanLimits` has no `maxSms` field. An org on the Starter plan can send unlimited SMS.
6. **No per-blast billing check**: The plan gate only checks if the org *is* on Starter+. It does not check if they've exceeded an SMS quota for the period.

---

## 2. Gap Analysis

### P0 — Blockers (must fix before any org sends a real SMS)

| # | Gap | Risk | Effort |
|---|-----|------|--------|
| 1 | ~~**SMS consent field on Supporter**~~ | ~~TCPA violation.~~ | **DONE** — `smsStatus` field added (`none\|subscribed\|unsubscribed\|stopped`, default `none`). Blast engine filters on `smsStatus: 'subscribed'`. Migration: `20260317_add_sms_consent_status`. |
| 2 | **STOP keyword processing** | Twilio handles carrier-level STOP, but the app needs to update `smsStatus` to `opted_out` when Twilio sends an opt-out webhook. Otherwise the app will keep queueing messages that Twilio silently drops (wasting money). | Add inbound message webhook at `/api/sms/inbound` that checks for STOP/UNSUBSCRIBE keywords and updates `supporter.smsStatus`. |
| 3 | **Twilio credentials in production** | Without them, every SMS/call attempt throws `TWILIO_ACCOUNT_SID env var is required`. | Set via `wrangler pages secret put` for each of the three env vars. |
| 4 | **10DLC registration** | US carriers block or throttle A2P (application-to-person) SMS from unregistered numbers. Without 10DLC brand + campaign registration, messages will be filtered at 1 msg/sec and many will be silently dropped. | Register brand in Twilio Console, create A2P 10DLC campaign (typically $4/mo + one-time $4 registration fee per campaign). This is a Twilio Console task, not code. |

### P1 — Should fix before first real org use

| # | Gap | Risk | Effort |
|---|-----|------|--------|
| 5 | **SMS usage limits in billing** | Unbounded cost exposure. An org could send 100K SMS on a $10/mo Starter plan. Twilio charges ~$0.0079/segment outbound. | Add `maxSms` to `PlanLimits`, add `smsSent` to `getOrgUsage()`, add `sms` to `isOverLimit()`, enforce in the blast send path. |
| 6 | **Nav links** | Org admins can't find the SMS/calls pages. | Add SMS + Calls entries to org sidebar nav, gated on `FEATURES.SMS`. |
| 7 | **Opt-in collection UI** | No way for supporters to consent to SMS. Need a checkbox on supporter import, event RSVP, and supporter edit forms. | Add `smsConsent` checkbox to import CSV parser, supporter edit page, and RSVP form. |

### P2 — Nice to have before launch

| # | Gap | Risk | Effort |
|---|-----|------|--------|
| 8 | **Recipient filter/segmentation** | `send-blast.ts` has a TODO: "Apply recipientFilter when segment query builder supports phone filtering." Currently blasts go to ALL supporters with phones. | Wire `recipientFilter` JSON into the Prisma `where` clause, matching the segment query builder used in email. |
| 9 | **SMS cost preview** | Org admin has no visibility into how many segments/dollars a blast will cost before sending. | Add a "Preview: ~X recipients, ~Y segments, ~$Z" line to the compose page. Query supporter count + estimate segment count from body length. |
| 10 | **Confirmation dialog before send** | "Send Now" fires immediately with no confirmation. Easy to accidentally blast. | Add a confirmation modal: "Send to ~X supporters? This cannot be undone." |

### P3 — Deferred / post-launch

| # | Gap | Effort |
|---|-----|--------|
| 11 | **Scheduled sends** | Add `scheduledAt` field to SmsBlast, cron/scheduled worker to fire at the right time. |
| 12 | **MMS / media support** | Twilio supports MediaUrl; would need file upload + storage. |
| 13 | **Two-way SMS conversations** | Full inbound message processing, threaded UI, auto-responses. |
| 14 | **International number support** | Different 10DLC rules per country; Twilio Messaging Service abstraction. |

---

## 3. TCPA / 10DLC Compliance Requirements

### TCPA (Telephone Consumer Protection Act)

The app **must** meet these requirements before sending any SMS to US numbers:

1. **Express written consent**: Supporters must affirmatively opt in to receive SMS. This cannot be pre-checked or bundled with email consent.
2. **Clear disclosure**: The opt-in form must disclose message frequency, that data rates apply, and how to opt out.
3. **STOP processing**: The app must honor STOP, UNSUBSCRIBE, CANCEL, END, QUIT keywords immediately.
4. **Quiet hours**: No SMS between 9 PM and 8 AM in the recipient's local time (some states are stricter).
5. **Record keeping**: Maintain a record of when and how each supporter opted in, for at least 4 years.

### 10DLC (10-Digit Long Code)

Required for A2P SMS in the US since 2023:

1. **Brand registration**: Register the organization in Twilio's Trust Hub. Requires EIN, website, contact info.
2. **Campaign registration**: Register each use case (e.g., "civic engagement notifications"). Requires sample messages, opt-in flow description, opt-out description.
3. **Throughput**: Unregistered numbers are throttled to 1 msg/sec with high filtering. Registered numbers get 15-75 msg/sec depending on trust score.
4. **Org-specific numbers**: Each org should ideally have its own Twilio number (or use Twilio Messaging Service with number pooling). The current implementation uses a single `TWILIO_PHONE_NUMBER` for all orgs.

### What Twilio handles automatically

- Carrier-level STOP/START keyword processing (Twilio's Advanced Opt-Out)
- Do-not-call list checking (for voice calls)
- Caller ID compliance

### What we must handle

- Recording consent with timestamp + method
- Honoring STOP at the application level (updating supporter records)
- Quiet hours enforcement
- 10DLC registration (Twilio Console, not code)
- Per-org phone number provisioning (future)

---

## 4. Bundle Size Impact

**No impact.** The Twilio REST client (`twilio.ts`) uses native `fetch()` and `node:crypto`. The Twilio Node SDK (15 MB) was explicitly avoided. The three SMS-related server files total ~6 KB. UI components are ~4 KB. All of this is already in the bundle since the code exists and `FEATURES.SMS = true`.

---

## 5. Go-Live Checklist

### Minimum viable (P0 — blocks first real SMS)

- [x] Add `smsStatus` field to Supporter model (`none|subscribed|unsubscribed|stopped`, default `none`)
- [x] Run Prisma migration (`20260317_add_sms_consent_status`)
- [x] Update `send-blast.ts` to filter on `smsStatus: 'subscribed'`
- [x] Add STOP webhook processing (6 keywords) and update `smsStatus`
- [ ] Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in Cloudflare Pages secrets
- [ ] Register 10DLC brand + campaign in Twilio Console
- [ ] Test with a single supporter (team member) end-to-end: opt-in, send blast, receive SMS, STOP, verify opt-out

### Before first org use (P1)

- [ ] Add `maxSms` to `PlanLimits` (suggested: free=0, starter=1000, organization=10000, coalition=50000)
- [ ] Add `smsSent` counting to `getOrgUsage()`
- [ ] Enforce SMS limit in blast send path (reject or warn when over limit)
- [ ] Add SMS + Calls links to org sidebar navigation
- [ ] Add SMS opt-in checkbox to supporter import, supporter edit, and event RSVP forms
- [ ] Add opt-in timestamp + method fields to Supporter model for compliance record-keeping

---

## 6. Testing Strategy Without Real SMS

The existing test suite (4 files, ~60 tests) already covers the full stack with mocked `fetch()` and mocked DB. This is sufficient for unit/integration testing. For additional confidence:

### Already covered

- `twilio-integration.test.ts`: sendSms, initiatePatchThroughCall, isValidE164, sendSmsBlast, both webhooks (35+ tests)
- `sms-crud.test.ts`: All CRUD endpoints, feature gate, plan gate, role guard, validation, pagination (25+ tests)
- `patch-through-call.test.ts`: Call initiation, Twilio error handling, supporter lookup, pagination (15+ tests)
- `sms-api-v1.test.ts`: Public API key auth, rate limiting, pagination

### Recommended additions for re-enablement

1. **Consent gate test**: Verify `sendSmsBlast` only sends to `smsStatus: 'opted_in'` supporters (new test after P0 migration).
2. **STOP webhook test**: Verify inbound STOP message updates `smsStatus` to `opted_out` (new test after P0 endpoint).
3. **Billing limit test**: Verify blast is rejected when org exceeds `maxSms` (new test after P1 billing work).
4. **Twilio test credentials**: Twilio provides test credentials (`AC_test...` SID prefix) that accept API calls but don't send real messages. Use these in a staging environment for end-to-end smoke tests.
5. **Ngrok/Cloudflare Tunnel for webhooks**: In dev, use a tunnel to receive real Twilio status callbacks against the local server.

### What NOT to test with real SMS

- Load testing (use Twilio's test credentials)
- Automated CI (keep using mocked fetch)
- Anything in production before 10DLC registration is approved

---

## 7. Cost Model

| Item | Cost |
|------|------|
| Twilio outbound SMS (US) | ~$0.0079/segment |
| Twilio inbound SMS (US) | ~$0.0075/message |
| Twilio outbound voice (US) | ~$0.014/min |
| Twilio phone number | $1.15/mo |
| 10DLC brand registration | One-time $4 |
| 10DLC campaign registration | $2/mo per campaign |

At scale: 10,000 single-segment SMS = ~$79. Multi-segment messages multiply proportionally.

---

## 8. Recommended Implementation Order

1. **Schema migration** (smsStatus field) — 30 min
2. **Consent filter in send-blast.ts** — 15 min
3. **Inbound STOP webhook** — 1 hr
4. **Twilio secrets + 10DLC registration** — 1 hr (mostly Twilio Console)
5. **Billing limits** — 1 hr
6. **Nav links** — 15 min
7. **Opt-in UI on import/edit/RSVP** — 2 hr
8. **End-to-end test with team member** — 30 min

**Total estimated effort: ~6 hours of code + Twilio Console work.**

The codebase is ready. The gaps are consent/compliance, billing limits, and operational setup — not missing functionality.
