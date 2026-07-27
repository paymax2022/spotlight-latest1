# Module: Notifications (async delivery service + workers)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** none dedicated (see §1 / `NOTIFICATIONS-SEC-001`)
**Code:** `backend/internal/notifications/` (`service.go`, `workers.go`, `model_test.go`); queue primitives `backend/internal/platform/queue/queue.go` (`NewTask`, `DecodePayload`, `TypeNotification{Push,Email,SMS}`, `NewServer` retry/queues); callers wire it inline (e.g. `backend/internal/app/finance_routes.go` restaurant/estate/price-alert notifiers, `backend/internal/app/health_triage_routes.go` `triageNotifier`).
**Slug:** `NOTIFICATIONS` (uppercase, used in Case IDs)

## 1. Overview & scope

This module is an **internal fan-out + async delivery** layer, **not an HTTP resource**. It has
**no Gin routes, no owner/read/mark-read endpoints, and no push-token registration API** — those
"list/mark-read/preferences" surfaces the reader may expect live in *other* domain packages
(orchestrator, doctor, marketplace handlers in `finance_routes.go`), each with their own tables and
authz, and are out of scope here. What this package actually exposes:

1. **`Service.Send(ctx, Notification)`** — enqueues one asynq task **per requested channel** onto
   Redis (`asynq.Client.EnqueueContext`) with `MaxRetry(3)`. When `Channels` is empty it defaults
   to `{push, in_app}`. Convenience helpers `WalletCredit`, `WalletDebit`, `KYCApproved`,
   `ReferralReward` build event-shaped notifications (they format ₦ amounts for **display only**;
   the authoritative kobo value rides in `Data.amount_kobo`).
2. **`Workers(mux, cfg)`** — registers three asynq consumers: `handlePush` (Expo),
   `handleEmail` (Resend), `handleSMS` (Termii). Each decodes the payload, **no-ops (returns nil)**
   when the target address/token or provider credential is absent, and returns an **error** (→
   asynq retry) only on a real transport/HTTP≥400 failure.

Testing weight sits in delivery semantics, not access control: (a) **fan-out correctness** — one
task per channel, correct task type; (b) **retry/skip discipline** — transient failures retry (≤3),
missing-config paths skip silently rather than poison the queue; (c) **idempotency of redelivery** —
the tasks carry **no idempotency key / dedupe id**, so a retry after a provider already accepted the
message can **double-send** (a real gap, see §6). Because the caller supplies `Notification.UserID`
and the delivery address, cross-user leakage is a **caller-side** concern (the caller must pass the
right owner's token/email/phone) — this package trusts its inputs.

Cross-cutting references (not repeated): async/queue retry semantics are asynq-native
(`queue.NewServer` critical/default/low queues); flags/audit pattern
`../cross-cutting/feature-flags-and-audit.md`; auth of the *calling* endpoints
`../cross-cutting/authentication.md`. No money-invariants file applies (no ledger mutation), but
assert the kobo value in `Data` is an **integer**, never re-derived from the formatted ₦ string.

## 2. Services / endpoints in scope

No HTTP endpoints. Service functions and worker handlers only.

| Operation | Service func / handler | Auth / permission | Money-path? |
|---|---|---|---|
| Enqueue on N channels | `Service.Send(ctx, Notification)` | internal (caller-authed) | no |
| Wallet-credit helper | `Service.WalletCredit(ctx,userID,amountKobo,ref)` | internal | no (display only) |
| Wallet-debit helper | `Service.WalletDebit(ctx,userID,amountKobo,ref)` | internal | no (display only) |
| KYC-approved helper | `Service.KYCApproved(ctx,userID,newTier)` | internal | no |
| Referral-reward helper | `Service.ReferralReward(ctx,referrerID,amountKobo)` | internal | no |
| Push consumer (Expo) | `workerHandler.handlePush` | queue consumer | no |
| Email consumer (Resend) | `workerHandler.handleEmail` | queue consumer | no |
| SMS consumer (Termii) | `workerHandler.handleSMS` | queue consumer | no |
| Channel→task-type map | `taskTypeForChannel(ch)` | internal | no |

Behavioral notes to assert:
- **Fan-out**: `Send` iterates `n.Channels`; each yields `queue.NewTask(taskType, n, MaxRetry(3))`
  then `EnqueueContext`. A `NewTask`/enqueue error aborts with a wrapped error — note this means a
  **partial fan-out** (earlier channels already enqueued) if a later channel fails.
- **`taskTypeForChannel` has no `in_app` case** — `ChannelInApp` (and any unknown channel) falls
  to the `default` branch → **`TypeNotificationPush`**. So the default `{push, in_app}` fan-out
  enqueues **two push tasks**, not one push + one in-app. Flag as a real defect
  (`NOTIFICATIONS-CON-003`).
- **Skip-vs-retry**: workers return `nil` (drain, no retry) when: push has empty `PushToken`; push
  has neither `ExpoPushToken` nor `ResendAPIKey` configured; email has empty `ResendAPIKey` or empty
  `n.Email`; SMS has empty `TermiiAPIKey` or empty `n.Phone`. They return an **error** (retry) only
  on `http.Do` failure or provider HTTP status ≥ 400.
- **Payload integrity**: `queue.NewTask` JSON-marshals the whole `Notification`; `DecodePayload`
  unmarshals it in the worker. `Data.amount_kobo` round-trips as a JSON number (int64).

## 3. Test matrix by layer

`model_test.go` **exists** and is AUTOMATED — it locks the channel/event constant contracts. All
behavioral send/worker coverage is TODO.

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| 4 distinct non-empty `Channel` constants | unit | `internal/notifications/model_test.go` (`TestChannelConstants`) | AUTOMATED |
| ≥12 distinct non-empty `Event` constants | unit | `internal/notifications/model_test.go` (`TestEventConstants`) | AUTOMATED |
| `Notification` required-field shape | unit | `internal/notifications/model_test.go` (`TestNotificationRequiredFields`) | AUTOMATED |
| KYC approved≠failed, credit≠debit distinctness | unit | `internal/notifications/model_test.go` (`TestKycEventsDistinct`, `TestWalletEventsDistinct`) | AUTOMATED |
| Queue task-type constants exist | unit | `internal/platform/queue/queue_test.go` | AUTOMATED (shared) |
| `Send` fan-out: one task per channel, correct type | unit | — | TODO |
| Default channels `{push,in_app}` when empty | unit | — | TODO |
| `taskTypeForChannel` mapping (incl. in_app→push defect) | unit | — | TODO |
| Helper builders set event/title/body/data | unit | — | TODO |
| Worker skip-vs-retry (missing token/config/address) | int | — | TODO |
| Worker retry on transient/HTTP≥400 | int | — | TODO |
| Redelivery double-send (no dedupe id) | inv/sec | — | TODO |
| `DecodePayload` round-trips `amount_kobo` int64 | unit | — | TODO |

## 4. Manual test cases

Because there are no HTTP endpoints, cases exercise `Send` (with a fake/`miniredis`-backed asynq
client) and the worker handlers (with a stub HTTP transport). "Enqueued" = task present on the
inspected queue; "delivered" = worker returned `nil` after a 2xx provider response.

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `NOTIFICATIONS-UNIT-001` | Send fans out one task per channel | P0 | client capturing enqueues | `Send` with `Channels:[push,email,sms]` | valid notification | 3 tasks enqueued: types `notification:push`, `:email`, `:sms`; each `MaxRetry=3` |
| `NOTIFICATIONS-UNIT-002` | Empty channels defaults to push+in_app | P1 | as above | `Send` with `Channels:nil` | notification, no channels | 2 tasks enqueued (see UNIT-003 for what type in_app resolves to) |
| `NOTIFICATIONS-UNIT-003` | in_app maps to push task type (defect) | P0 | as above | `Send` with `Channels:[in_app]` | — | 1 task of type `notification:push` — documents that **no** in-app consumer exists; flag as defect in report |
| `NOTIFICATIONS-UNIT-004` | Helper builders shape payload | P1 | — | call `WalletCredit(u,500000,"ref-1")` | 500000 kobo | notification `Event=wallet.credit`, `Data.amount_kobo=500000` (int), body shows `₦5000.00` (display) |
| `NOTIFICATIONS-UNIT-005` | amount_kobo stays integer through round-trip | P0 | — | `NewTask`→`DecodePayload` on WalletDebit | 1234567 kobo | decoded `Data.amount_kobo==1234567`; never a float/string; body ₦ is display-only |
| `NOTIFICATIONS-INT-001` | Push worker delivers on 2xx | P0 | Expo token set; stub transport → 200 | run `handlePush` | payload with `PushToken:"ExpoTok"` | returns nil; exactly one POST to `exp.host/--/api/v2/push/send`, `Authorization: Bearer` set |
| `NOTIFICATIONS-INT-002` | Email worker delivers on 2xx | P1 | `ResendAPIKey` set; stub → 200 | run `handleEmail` | `Email:"a@b.co"` | nil; one POST to `api.resend.com/emails`, `to:["a@b.co"]`, subject=Title |
| `NOTIFICATIONS-INT-003` | SMS worker delivers on 2xx | P1 | `TermiiAPIKey` set; stub → 200 | run `handleSMS` | `Phone:"+2348012345678"` | nil; one POST to Termii send with `sms=Body` |
| `NOTIFICATIONS-INT-004` | Push skips (no token) — drain not retry | P0 | provider configured | run `handlePush` | `PushToken:""` | returns nil; **no** HTTP call; task acked (not retried) |
| `NOTIFICATIONS-INT-005` | Push skips (no provider configured) | P1 | `ExpoPushToken=""` & `ResendAPIKey=""` | run `handlePush` | valid token | nil; no HTTP call |
| `NOTIFICATIONS-INT-006` | Email skips (no address / no key) | P1 | key unset OR `Email:""` | run `handleEmail` | each case | nil; no HTTP call |
| `NOTIFICATIONS-INT-007` | SMS skips (no phone / no key) | P1 | key unset OR `Phone:""` | run `handleSMS` | each case | nil; no HTTP call |
| `NOTIFICATIONS-INT-008` | Worker retries on transient failure | P0 | provider set; stub → network error then 200 | enqueue push; let asynq retry | valid | 1st attempt errors (queued for retry), later attempt delivers; ≤3 retries (`MaxRetry`) |
| `NOTIFICATIONS-INT-009` | Worker errors on provider HTTP≥400 | P0 | provider set; stub → 500 | run `handlePush` | valid | returns error including status+body; task retried; after 3 fails → dead/archived |
| `NOTIFICATIONS-CON-001` | Malformed payload → decode error | P1 | — | invoke handler with non-JSON task payload | garbage bytes | handler returns `decode` error (not panic); task retried/dead-lettered |
| `NOTIFICATIONS-CON-002` | Enqueue failure aborts Send | P2 | client whose `EnqueueContext` errors on 2nd channel | `Send` with `[push,email]` | — | `Send` returns wrapped `enqueue` error; **partial** fan-out possible (push already enqueued) — flag as at-least-once risk |
| `NOTIFICATIONS-CON-003` | Unknown channel resolves to push | P2 | capturing client | `Send` with `Channels:["carrier-pigeon"]` | — | 1 `notification:push` task (default branch); no rejection/validation of unknown channels |
| `NOTIFICATIONS-INV-001` | Redelivery double-send (no dedupe) | P0 | provider set; stub counts POSTs | deliver same task twice (simulated retry after provider accepted) | identical payload | **Two** provider POSTs — task carries no idempotency/dedupe id; document as duplicate-delivery gap (§6) |
| `NOTIFICATIONS-SEC-001` | No feature flag / fail-safe when unconfigured | P1 | no `FEATURE_NOTIFICATIONS_*`; providers unset | wire `Send` + run workers | valid | Enqueue still succeeds; workers **skip** (nil) with no provider — module degrades safely, never 500s the caller. Contrast with `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001 (routed modules 404 when off); note this module has no route/flag to gate |
| `NOTIFICATIONS-SEC-002` | Caller owner-binding (no cross-user leak) | P0 | two users | caller builds notification for `user-a` | `UserID:"user-a"`, `Email:a@…`, `PushToken` of a | Delivery address must be `user-a`'s; assert the **calling** endpoint binds address to the token owner, since `Send` trusts inputs (see §6) |

## 5. State-machine transitions

Delivery has a lifecycle enforced by **asynq**, not a domain FSM in this package, but it is worth
asserting as a state model per task:

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (enqueued) | worker picks up | processing | `DecodePayload` | `NOTIFICATIONS-FSM-001` |
| processing | provider 2xx | delivered (acked) | one provider POST; returns nil | `NOTIFICATIONS-FSM-002` |
| processing | missing token/config/address | skipped (acked) | no HTTP call; returns nil | `NOTIFICATIONS-FSM-003` |
| processing | transport error / HTTP≥400 | retry-scheduled | returns error; retry count++ | `NOTIFICATIONS-FSM-004` |
| retry-scheduled | retries exhausted (>3) | archived/dead | task no longer retried | `NOTIFICATIONS-FSM-005` |

Illegal / must-not-happen assertions:
- `NOTIFICATIONS-FSM-006` — a **skipped** (nil-return) task must **not** be retried (distinguish
  "no address" from "transport failure"): skip returns nil, failure returns error.
- Re-entering **delivered** on redelivery is **not** idempotent today (double provider POST) —
  tracked as `NOTIFICATIONS-INV-001`, the key gap this section highlights.

## 6. Security & abuse cases

- **Duplicate delivery / no idempotency key** — `queue.NewTask` sets only `MaxRetry(3)`; there is
  **no** `asynq.TaskID`/unique key, so at-least-once retry semantics can double-send on any
  post-accept failure (`NOTIFICATIONS-INV-001`, `NOTIFICATIONS-CON-002`). Recommend a stable
  dedupe id (e.g. `event:userID:reference`) — flag in report.
- **Cross-user delivery** — `Send` trusts `UserID` + address from the caller; a caller passing a
  victim's `PushToken`/`Email` would deliver to the wrong person. The guard belongs to the calling
  endpoint (must bind address to the authenticated owner) — `NOTIFICATIONS-SEC-002`; see
  `../cross-cutting/authentication.md`.
- **Provider credential handling** — API keys (`ResendAPIKey`, `TermiiAPIKey`, `ExpoPushToken`)
  come from `ProviderConfig`/env and are sent as `Authorization: Bearer` / JSON `api_key`. Assert
  they are never logged (log lines log `user`/`event` only, not tokens) and never placed in the
  notification payload/`Data`.
- **Payload injection into provider APIs** — `Title`/`Body`/`Data` are attacker-influenced when the
  originating event carries user content; assert JSON marshalling escapes them and no header/URL is
  built from payload fields (URLs are constants; recipient is a discrete JSON field, not
  URL-interpolated — keeps user data out of query strings).
- **Fail-safe when unconfigured** — missing provider creds cause a logged **skip**, never a 500 to
  the caller (`NOTIFICATIONS-SEC-001`); the enqueue side likewise must not crash a money/KYC path
  that fires a best-effort notification (callers already treat delivery as non-fatal).
- **Queue poisoning** — a malformed payload returns a decode error (`NOTIFICATIONS-CON-001`) and is
  retried/dead-lettered by asynq, not panicked; assert the worker never panics the whole ServeMux.

## 7. Automated specs to add

- `internal/notifications/service_test.go` — table-driven, following the existing
  `model_test.go` style, with a fake/capturing asynq client (or `miniredis` + real client):
  fan-out count & task types per channel set; empty→`{push,in_app}` default;
  `taskTypeForChannel` mapping incl. the **in_app→push** defect; helper builders set
  event/title/body and integer `Data.amount_kobo`; `EnqueueContext`-error → wrapped error +
  partial-fan-out documentation.
- `internal/notifications/workers_test.go` — table-driven worker tests with an `http.RoundTripper`
  stub injected into `workerHandler.http`: 2xx→nil+one call per channel; skip paths (no token / no
  config / no address)→nil+zero calls; network error and HTTP≥400→error; `DecodePayload` failure
  on garbage payload→decode error. Assert correct URLs (Expo/Resend/Termii) and headers.
- `backend/tests/notifications_delivery_test.go` — asynq-integration (miniredis) proving retry
  count ≤ `MaxRetry(3)`, dead-letter after exhaustion, and the **double-send on redelivery** gap
  (NOTIFICATIONS-INV-001) as a regression guard once a dedupe id is added.

Mark all three TODO in the traceability matrix (§3).

## 8. Coverage target & exit criteria

Tier-2 module: target ≥ 80% on `service.go` (`Send`, helpers, `taskTypeForChannel`) and the three
worker skip/deliver/error branches in `workers.go` — these are pure/stubbable and carry the real
risk. **Exit criteria (all must be green before release):** NOTIFICATIONS-UNIT-001,
NOTIFICATIONS-UNIT-003 (in_app defect documented/decided), NOTIFICATIONS-UNIT-005,
NOTIFICATIONS-INT-001, NOTIFICATIONS-INT-004, NOTIFICATIONS-INT-008, NOTIFICATIONS-INT-009,
NOTIFICATIONS-CON-001, NOTIFICATIONS-SEC-002, and a recorded decision on NOTIFICATIONS-INV-001
(duplicate delivery) — either an accepted risk with a caller-side dedupe or a task-id fix.
The existing `model_test.go` cases must remain green.
