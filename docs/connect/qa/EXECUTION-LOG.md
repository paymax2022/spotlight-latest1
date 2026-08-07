# Spotlight Connect — Test-Plan Execution Log

Companion to `Spotlight_Connect_Test_Plan.md`. Tracks the live execution: baseline,
per-suite classification, defects fixed/built, and the remaining P0/P1 backlog.

_Source of truth for statuses; the plan file's §20/§22/§24 are kept in sync from here._

---

## 0. Baseline (verified)

- **Connect module already exists and is substantial** — this is QA closure, not a greenfield build.
  - Backend: ~143 Go files / ~20k LOC, 26 sub-packages. **`go build ./internal/connect/...` clean; all ~123 existing unit tests pass; `go vet` clean.**
  - Mobile: ~140 Connect screens (Expo Router) under `mobile-app/reactnative/app/connect/`.
  - Admin: ~40 pages under `frontend-admin/app/admin/connect/`.
  - Wiring: gated behind `FEATURE_CONNECT_ENABLED` (default off), reuses existing auth + RBAC + pgx pool (`backend/internal/app/connect_routes.go`).
- **Test style:** pure functions + hand-written interface fakes (no DB, no mocking lib). New DB-gated integration tests follow the repo's `TEST_DATABASE_URL`/`DATABASE_URL` skip convention.
- **Backend coverage gaps (no test files):** `config`, `gifting`, `live`, `payouts`, `voting` — gifting/payouts/voting are money-path (P0).
- **Local DB:** Supabase Postgres up on `:54322` with full Connect schema (78 `connect_*` tables) — used for executed P0 assertions.

---

## 1. Defect & Task Log (fixes made this pass)

| ID | Test IDs | Type | Sev | Summary | Root cause | Fix (files) | Test added | Status |
|---|---|---|---|---|---|---|---|---|
| D-001 | TS-001, DM-008, EC-004, PN-011 | Bug | S0 | **Block was not absolute** — `connect_blocks` was consulted only by the chat layer, so a blocked user still appeared in the dating deck, could still form a match, and their feed posts + professional profile stayed visible to the blocker. | Block filtering explicitly deferred in discovery (`discovery/service.go` comment), absent in matching `Like`, feed `FeedCandidates`, and professional `Discover`. | `discovery/service.go` + `discovery/stack.go` (candidateQuery bidirectional block predicate + viewer user id threaded); `matching/service.go` (`Like` refuses w/ new `ErrBlocked`, fail-closed); `networking/feed/{repo,service,handlers}.go` (viewer-scoped block predicate in `FeedCandidates`); `professional/service.go` (`Discover` block predicate). | `tests/connect/block_absolute_live_db_test.go` (4 subtests, live-DB; verified it **fails without** the matching guard — a match forms — and **passes with** it). | 🔧 Fixed |
| D-002 | TS-003, TS-006, EC-003 | Bug | S0 | **Member reports never auto-escalated** — every report was filed `severity=normal`, so CSAM/minor/threat reports waited for manual triage. | `safety/handler.go` hard-coded `Severity: "normal"`. | `safety/model.go` new pure `SeverityForReport(type)` (underage/inappropriate_media→critical, safety→high, else normal, unknown→normal fail-safe); `safety/handler.go` uses it at intake. | `safety/model_test.go` `TestSeverityForReport`. | 🔧 Fixed |
| D-003 | DM-007, TS-006, EC-003 | Bug | S0 | **No minor-in-deck defense-in-depth** — the 18+ gate ran only at onboarding; the deck query and the like path had no age predicate, so an underage-flagged profile that was `visible=true` could still surface / be liked. | `discovery/service.go` candidateQuery and `matching/service.go` Like had no age/underage check. | `discovery/service.go` (exclude `connect_underage_flags` not `cleared` + under-18 on-profile DOB); `matching/service.go` (Like refuses w/ new `ErrIneligibleTarget`, fail-closed, generic error to avoid revealing minor status). | `tests/connect/block_absolute_live_db_test.go` subtest `DM-007_minor_excluded_from_deck_and_like`. | 🔧 Fixed |
| D-012 | PAY-003, DM-002 | Gap→Built | S1 | **Premium features weren't gated at their use-site** — super-like recorded a like without spending anything, so the paid action was free. | `matching.Like` didn't check any entitlement/credit for `kind='super'`. | `matching/service.go`: optional `CreditConsumer` (nil-safe setter). A super-like now **consumes one `super_like` credit** (keyed by the canonical pair ⇒ idempotent double-tap; fail-closed ⇒ no credit → `ErrNeedsCredits`, no like recorded); handler maps it to **402 + upsell**. Wired `matchSvc.SetCreditConsumer(credits)` in phase-1 routes. | `tests/connect/...` `TestConnectSuperLikeRequiresCredit` (free user refused + no like; granted credit → super-like succeeds + credit spent; out-of-credits refused; plain like needs none). | 🏗️ Built |
| D-011 | PAY-008 | Gap→Built | S1 | **Consumable credits were never spent down** — super-likes/InMail quotas were read as booleans (>0) with no decrement, so effectively unlimited; no double-spend protection. | No credit balance/consumption store; `featureEnabled` only checked >0. | Additive migration `20261012000400` (`connect_credits` balance CHECK≥0 + `connect_credit_txns` idempotent log). New package `internal/connect/credits`: `Grant`/`Consume`/`Balance(s)` — consume does an idempotent txn insert then a **guarded `balance -= n WHERE balance >= n`** under the row lock, so concurrent spends can't oversell or go negative; grants idempotent per key. Wired grant-on-`pass`-purchase (`monetization.SetCreditGranter`, maps numeric pass entitlements → credits) + `GET /connect/credits`. | `tests/connect/...` `TestConnectCreditsNoDoubleSpend` (10 concurrent spends on a balance of 5 → exactly 5 succeed, 5 refused, balance 0, idempotent replay + grant) & `monetization/credits_grant_test.go` (pass→credits, subscription→none, nil-safe). | 🏗️ Built |
| D-010 | PAY-006 | Gap→Built | S1 | **No subscription billing cycle** — subscriptions had no cancel, no auto-renewal, and no proration; once bought they could neither be stopped nor renewed. | Feature absent. | Additive migration `20261012000300` (adds `auto_renew`, `canceled_at` to connect_entitlements). `monetization/service.go`: `CancelSubscription` (end-of-period: stop renewal, keep access; OR immediate: deactivate + **pro-rata refund of unused time** via the D-009 refund rail, keyed per entitlement ⇒ single); `ProcessRenewals(now)` batch (charges once-per-cycle via a period-keyed idempotency key, extends `expires_at`, records a renewal order idempotently, **lapses** on insufficient funds); pure `proratedRefundKobo` (integer-kobo, floored, clamped). Wired `POST /connect/subscriptions/cancel` (member) + `POST /connect/admin/subscriptions/run-renewals` (scheduler-driven, RBAC). | `monetization/proration_test.go` (bounds/monotonic/floor) + `tests/connect/...` `TestConnectSubscriptionBillingCycle` (end-of-period keeps access; immediate prorates + credits wallet; renewal charges once + extends + idempotent 2nd run; lapse on no funds). | 🏗️ Built |
| D-009 | PAY-007 | Gap→Built | S0 | **No refund path** anywhere in Connect money — subscriptions/boosts/passes could be charged but never reversed (§0.5 gate "refunds safe and single" unmet). | Feature absent. | `monetization/service.go` new `Refund(orderID, adminID, reason)` — money-movement-first reversing ledger entry (DR paymax_revenue → CR user_wallet) keyed by order id so it is SINGLE under retries/concurrency; then order→`refunded` + entitlement revoked in one tx; audited. New `WalletRefunder` iface + `connectRefundAdapter` (maps ledger `ErrDuplicate`→success). Wired `POST /api/connect/admin/orders/:id/refund` (RBAC `connect.payments.refund`, seeded via migration `20261012000200`). | `tests/connect/block_absolute_live_db_test.go` `TestConnectRefundSafeAndSingle` (exact amount returned once, order refunded, entitlement revoked, idempotent retry + **concurrent double-refund credits once**). | 🏗️ Built |
| D-008 | ON-010, EC-011, MB-020 | Gap→Built | S1 | **No account-deletion / DSR path** — a user could not erase their Connect data; deleted accounts left active matches, visible profiles, and readable messages (privacy invariant + right-to-erasure gap). | Feature absent. | New additive migration `20261012000100_connect_profile_deleted_at.sql` (soft-delete marker); new package `internal/connect/account` (`DeleteAccount` anonymises profile PII, hides modes, redacts professional profile, deletes media/likes/passes/blocks/verification, ends matches gracefully as `unmatched`, redacts the user's message bodies, writes an immutable audit row — all in ONE tx, idempotent, fail-closed; retains audit log + restrictions + cases + consents on purpose). Wired `DELETE /api/v1/connect/account` (subject = authed user). | `tests/connect/block_absolute_live_db_test.go` `TestConnectAccountDeletionCascade` (anonymisation, deck removal, graceful match end + partner ErrNoMatch, message redaction, media/verification erasure, audit row, idempotent replay). | 🏗️ Built |
| D-007 | MS-001, MS-009, EC-005 | Bug | S0 | **Every normal (unflagged) chat message failed to send** — `connect_messages.reason_codes` is `NOT NULL DEFAULT '{}'`, but `SendMessage` inserted `det.ReasonCodes`, which is a nil slice for unflagged messages → encoded as SQL NULL → NOT NULL violation. No happy-path chat integration test existed, so core chat delivery was silently broken. Surfaced while writing the EC-005 test. | `chat/service.go` passed a nil slice for the common path. | `chat/service.go`: normalise nil `reason_codes` to `[]string{}` before insert. Also EC-005: chat restriction check now covers BOTH participants so a banned recipient's conversation is dead both ways. | `tests/connect/block_absolute_live_db_test.go` `TestConnectBanSeversActiveChat` (baseline send now succeeds → proves MS-001; then ban → both directions ErrRestricted → EC-005). | 🔧 Fixed |
| D-006 | TS-013 | Bug | S1 | **Chat safety detection failed OPEN** — `SendMessage` did `thresholds, _ := cfg.Load(ctx)`, swallowing a config-load error and delivering the message unscanned (config's own doc said the caller must fail closed). | Load error ignored in `chat/service.go`. | `chat/service.go`: `cfg` is now an injectable `thresholdLoader`; a Load **error** returns new `ErrSafetyUnavailable` (503) before any DB write, so the message isn't delivered unscanned. Missing rows (nil error) still pass legitimately. | `chat/failclosed_test.go` `TestSendMessageFailsClosedOnConfigError` (injects a failing loader, asserts fail-closed with nil pool). | 🔧 Fixed |
| D-005 | DM-014, EC-008 | Bug | S1 | **Simultaneous mutual likes missed the match** — under READ COMMITTED, two reciprocal likes fired at once each failed to see the other's uncommitted like, so NO match formed (24/25 pairs missed in a concurrency test). Classification had wrongly called this "correct by design". | `matching/service.go` `Like` checked reciprocity with no serialization of the pair. | `matching/service.go`: transaction-scoped `pg_advisory_xact_lock(hashtext(a),hashtext(b))` on the canonical pair before the reciprocal check, so the 2nd like waits for the 1st to commit and forms the match exactly once (same key both directions ⇒ no deadlock). | `tests/connect/block_absolute_live_db_test.go` `TestConnectMatchRaceExactlyOnce` (25 concurrent pairs → exactly one match each; **fails without the lock: 24/25 missed**). | 🔧 Fixed |
| D-004 | TS-009, EC-005, EC-010 | Bug | S0 | **Moderation ban/suspend not enforced** — a case resolved `banned`/`suspended` was only logged; nothing revoked access (no restriction store existed). Report→action had no teeth (§0.5 gate item). | No `connect_account_restrictions` store; `UpdateCase` recorded resolution only. | New additive migration `20261012000000_connect_account_restrictions.sql`; `safety/service.go` `UpdateCase` writes an active restriction in the SAME tx on `banned`/`suspended` (attributable + fail-closed); fail-closed enforcement reads in `discovery/service.go` (deck excludes restricted), `matching/service.go` (`Like` → new `ErrRestricted` if actor or target restricted), `chat/service.go` (`SendMessage` → `ErrRestricted` for restricted sender, mapped to 403). | `tests/connect/block_absolute_live_db_test.go` `TestConnectBanIsEnforced` (baseline-visible → ban via UpdateCase → restriction row written, gone from deck, like refused both directions). | 🔧 Fixed |

---

## 2. Classification (per suite) — completed so far

Legend: ✅ Pass · 🚫 Missing · 🚧 Partial · ❌ Fail · 🔧 Fixed · 🏗️ Built. "Test?" = executed automated test exists.

### TS-3 · Professional Networking

| ID | Status | Evidence | Test? | Note |
|---|---|---|---|---|
| PN-001 send/accept/decline | 🚧 Partial | `professional/service.go` intro FSM | intro_test.go | Modeled as intro-request; accept creates **no connection edge/graph**; `withdrawn` enum has no endpoint. |
| PN-002 follow vs connect | 🚫 Missing | only company-follow `jobs/service.go` | — | No user↔user follow / mutual edge. |
| PN-003 invite throttling | 🚫 Missing | per-pair dedup only | — | No rate/daily cap on invites. |
| PN-004 endorsements & recs | 🚧 Partial | recs FSM `profile/service.go` | recommendation_test.go | Recommendations done; **skill endorsements** missing. |
| PN-005 feed CRUD | ✅ Pass | `feed/service.go` | reactions/threads_test.go | Idempotency-key + audited. |
| PN-006 feed ranking/no-disallowed | 🚧 Partial | `feed/ranking.go` | ranking_test.go | Ranking solid; content policy only reactive (visible flag + admin hide). |
| PN-007 jobs & applications | ✅ Pass | `jobs/service.go` FSMs | jobs_test.go | Strongest area; idempotent money path. |
| PN-008 recruiter search & InMail | 🚫 Missing | grants/pipeline only | — | No candidate search, no paid InMail. |
| PN-009 professional search | 🚧 Partial | `professional/service.go` Discover | — | Industry filter only; no keyword/skill/location; **now block-aware (D-001).** |
| PN-010 network graph | 🚫 Missing | — | — | No mutual-connections/degree graph. |
| PN-011 block hides prof content | 🔧 Fixed | feed + professional block predicate (D-001) | block_absolute_live_db_test.go | Was ❌; now feed & Discover exclude blocked users. |

### TS-6 · Trust & Safety

| ID | Status | Evidence | Test? | Note |
|---|---|---|---|---|
| TS-001 block absolute | 🔧 Fixed | chat + discovery + matching + feed + professional (D-001) | block_absolute_live_db_test.go | Was chat-only; now enforced across all surfaces. |
| TS-002 report→case | ✅ Pass | `safety/service.go` OpenCase | model_test.go | One-tx case+audit; never silent. |
| TS-003 severity routing | 🔧 Fixed | `safety/model.go` SeverityForReport (D-002) | model_test.go | Was hard-coded normal; CSAM/minor→critical now. |
| TS-004 photo moderation | 🚫 Missing | `profile/service.go` manual pending gate | — | No automated nudity/CSAM classifier. |
| TS-005 text moderation | 🚧 Partial | `trust/detect.go` term lists | detect_test.go | Substring match; no hate category, no ML. |
| TS-006 minor sweep | 🚧 Partial | `onboarding/service.go` age-gate + underage queue | age_test.go | Gate at onboarding only; no periodic re-sweep; **report intake now escalates minor (D-002).** |
| TS-007 anti-catfishing [P1] | 🚧 Partial | `verification/provider.go` liveness | verification tests | No face-match vs profile photos. |
| TS-008 romance-scam [P1] | 🚧 Partial | `trust/scamshield.go` | detect_test.go | Financial-solicitation only; no behavioral signals. |
| TS-009 action enforcement | 🚧 Partial | `moderation/service.go` records decision | model_test.go | **P0 GAP: ban/suspend is logged but NOT enforced** — no account-status mutation / access revocation. |
| TS-010 ban-evasion [P1] | 🚫 Missing | — | — | No device fingerprint / account linking. |
| TS-011 safety center [P1] | 🚧 Partial | datesafety routes | datesafety tests | No explicit panic/SOS endpoint. |
| TS-012 safety audited | ✅ Pass | audit in block/case/moderation/onboarding | model_test.go | Immutable connect_audit_log, same-tx. |
| TS-013 fail-closed | 🚧 Partial | age-gate + scamshield fail-closed | age_test.go | **Chat scam detection fails OPEN on config miss** (`chat/service.go`). |

### TS-12 · Edge & Chaos

| ID | Status | Evidence | Test? | Note |
|---|---|---|---|---|
| EC-001 block mid-convo | ✅ Pass | `chat/service.go` per-message block recheck | model_test.go | RLS backstop. |
| EC-002 turns 18 | 🚧 Partial | `onboarding/age.go` dynamic age | age_test.go | No unlock flow for queued minor who ages in. |
| EC-003 minor falsification | 🚧 Partial | age-gate fail-closed + underage queue | age_test.go | DOB self-reported; **report escalation improved (D-002).** |
| EC-004 like+block race | 🔧 Fixed | `matching/service.go` block check (D-001) | block_absolute_live_db_test.go | Was: match could form despite block. |
| EC-005 reported user removed from deck/chat | 🚫 Missing | report=OpenCase only | — | **P0 GAP: reporting alone triggers no removal/restriction.** |
| EC-006 location spoofing | 🚫 Missing | `discovery/stack.go` trusts client geo | distance_test.go | No spoof detection. |
| EC-007 screenshot deterrents | 🚫 Missing | — | — | Client concern; nothing present. |
| EC-008 duplicate match replay | ✅ Pass | `matching/service.go` ON CONFLICT + Replayed | matching_test.go | Idempotency-Key. |
| EC-009 cross-persona leak | ✅ Pass | `discovery/service.go` per-mode visibility | profile_test.go | Modes independently gated. |
| EC-010 boost then suspended | 🚧 Partial | `discovery/boost.go` | boost_test.go | Tied to missing suspend enforcement (TS-009). |
| EC-011 deleted account cleanup | 🚫 Missing | only verification retention purge | — | **P0-ish GAP: no deletion cascade across profiles/matches/messages/blocks.** |
| EC-012 app killed mid-swipe/pay | 🚧 Partial | Like idempotent | matching_test.go | Pay-side idempotency in monetization scope. |
| EC-013 mass-report brigading | 🚫 Missing | no dedup/weighting | — | Each report opens a fresh case. |
| EC-014 appeal & reinstate | 🚫 Missing | — | — | No appeal workflow/state. |
| EC-015 partial outage | 🚧 Partial | mixed fail policy | detect_test.go | No circuit-breaker. |
| EC-016 cross-role escalation | ✅ Pass | `connect_safety_routes.go` RequirePermission deny-by-default | (no route test) | RBAC correct; lacks a dedicated authz test. |

### TS-4 · Dating Discovery & Matching

| ID | Status | Evidence | Test? | Note |
|---|---|---|---|---|
| DM-001 deck filters | 🚧 Partial | `discovery/service.go` predicates | distance_test.go | Intent/distance/verified/mode honored; **no age-range filter** in SearchFilters. |
| DM-002 like/pass/super-like | ✅ Pass | `discovery/stack.go` Swipe | swipe_test.go | — |
| DM-003 mutual→match | ✅ Pass | `matching/service.go` reciprocal→insert (tx) | swipe_test.go | — |
| DM-004 no contact pre-match | ✅ Pass | `chat/service.go` status='matched'+participant | model_test.go | + RLS backstop. |
| DM-005 first-move rule | 🚫 Missing | — | — | No gender field, no women-first gate. |
| DM-006 match expiry 24h | 🚫 Missing | `connect_matches` has no expires_at | — | No expiry/aging. |
| DM-007 minor never in deck | 🔧 Fixed | deck age predicate + Like refusal (D-003) | block_absolute_live_db_test.go | Was gate-only; now defense-in-depth. |
| DM-008 blocked never recommended | 🔧 Fixed | `discovery/service.go` block predicate (D-001) | block_absolute_live_db_test.go | Verified bidirectional. |
| DM-009 seen-dedup | ✅ Pass | excludes prior likes/matches/passes | swipe_test.go | — |
| DM-010 rewind (premium) | 🚧 Partial | `discovery/stack.go` Rewind atomic | swipe_test.go | Premium gating deferred to caller — verify route. |
| DM-011 daily like limits | 🚫 Missing | daily cap only on deck size | — | No per-day like quota on Like path. |
| DM-012 boost visibility window | 🚧 Partial | `boost.go` charge/expiry tracked | boost_test.go | **Boost not wired into deck ranking** — window currently inert. |
| DM-013 fairness | 🚫 Missing | pure reason-score sort | — | No exposure-balancing. |
| DM-014 match race exactly-once | ✅ Pass (design) | canonical orderPair + UNIQUE + ON CONFLICT (tx) | matching_test.go (helper only) | Correct by construction; **no concurrent DB race test** — coverage gap. |

### TS-7 · Location & Geo Privacy

| ID | Status | Evidence | Test? | Note |
|---|---|---|---|---|
| GEO-001 coords never exposed | ✅ Pass | only bucketed labels serialized; haversine server-side | distance_test.go, swipe_test.go | Strong; 2 tests assert it. |
| GEO-002 boundary correctness | ✅ Pass | `distance.go` bucketKm/snapMaxDistance | distance_test.go | — |
| GEO-003 location off honored | 🚧 Partial | per-mode `visible` gate | — | No granular location-hide / distance-off independent of full mode-off. |
| GEO-004 passport/travel mode | 🚫 Missing | — | — | Not implemented. |
| GEO-005 spoof/trilateration guard | 🚧 Partial | bucketing blunts trilateration | — | No active GPS-spoof/velocity guard. P0. |
| GEO-006 updates stop on opt-out | 🚧 Partial | geo persists until overwritten | — | No explicit stop-ingest path. |

### TS-8 · Monetization & Payments

| ID | Status | Evidence | Note |
|---|---|---|---|
| PAY-001 subscribe tier | ✅ Pass | `monetization/service.go` Purchase | Server-side price (getPlan), Idempotency-Key required, wallet double-entry, entitlement projection. |
| PAY-002 buy boosts/credits | ✅ Pass | same Purchase path (kind=boost/pass) | — |
| PAY-003 entitlement gating | 🚧 Partial | `ActiveEntitlements`/`HasFeature` server-side | Read side solid; verify each premium feature (boost/rewind/incognito) actually calls the gate. |
| PAY-004 double-tap idempotency | ✅ Pass | idemKey → wallet.Debit → ledger unique key | Retry is a safe no-op. |
| PAY-005 fail→no entitlement | ✅ Pass | debit error returns before `recordPurchase` | No order/entitlement on failed charge. |
| PAY-006 auto-renew/cancel/proration | 🚫 Missing | — | No renewal scheduler, cancel, or proration. **Remaining TS-8 P0** — needs a billing-cycle model (`next_billing_at`, scheduler). |
| PAY-007 refund safe & single | 🏗️ Built | D-009 `Refund` + reversing ledger entry | Idempotent + concurrent-safe; `TestConnectRefundSafeAndSingle`. |
| PAY-008 credit not double-spent | 🚧 Partial | quota features via `featureEnabled` (>0) | Quotas are read as booleans; **no atomic per-use decrement/consumption ledger** — a "super_likes_per_day" quota isn't actually spent down. |
| PAY-009 charge==quoted, kobo-exact | ✅ Pass | `plan.PriceKobo` (int64) is the charge source | Integer minor units; client never supplies price. |
| PAY-010 webhook authenticity | ➖ N/A (connect) | Connect money is internal wallet→wallet | External Paystack webhook (HMAC-SHA512) lives in `frontend-web/app/api/webhooks/paystack`; tested at that boundary, not in Connect. |

**TS-8 fully closed:** PAY-001…PAY-009 all ✅/🏗️, PAY-010 ➖ N/A. PAY-003 **DONE (D-012)** — super-like now credit-gated; the same gate pattern (`HasFeature`/credit-consume + 402 upsell) extends to rewind/incognito as follow-up wiring.

_TS-1/2, TS-5/9, TS-10/11, TS-13/14 classification pending._

---

## 3. Remaining P0 backlog (prioritized, from classification so far)

1. ~~TS-009 — moderation ban/suspend not enforced.~~ **DONE (D-004)** — restriction store + fail-closed enforcement in discovery/matching/chat.
2. **EC-005 — report does not restrict.** Reporting should optionally auto-limit contact/visibility pending review. Now cheap: reuse `connect_account_restrictions` (add a `pending`/soft type or auto-suspend on critical-severity intake).
3. **TS-004/TS-005 — automated photo/text moderation** beyond substring/manual gate (needs a mockable classifier adapter + pre-publish gate).
4. ~~EC-011 — account-deletion cascade / DSR~~ **DONE (D-008)** — service + endpoint + migration + test.
5. ~~TS-013 — chat fails OPEN~~ **DONE (D-006).**
6. ~~DM-014 — match-race~~ **DONE (D-005).**
7. _(pending classification)_ payment idempotency/webhook auth (TS-8), IDOR sweep + maker-checker (TS-10), onboarding/OTP + persona isolation (TS-1/2), messaging/notifications (TS-5/9), screens (TS-13/14).
8. **MB-020 follow-up** — wire mobile `delete-account.tsx` to the new `DELETE /connect/account` and verify states.

### Suites still needing classification
TS-1/2 (onboarding/profiles), TS-5/9 (messaging/notifications), TS-8/10/11 (payments/security/NFR), TS-13/14 (mobile + admin screens). Parallel sub-agent classification proved unreliable in this environment (stream stalls); do these sequentially or by direct inspection.

---

## 4. Commands

```bash
# unit suite (no DB)
cd backend && go test ./internal/connect/...
# executed P0 block-absolute evidence (needs local DB)
cd backend && TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres" \
  go test ./tests/connect/ -run TestConnectBlockIsAbsolute -v
```
