# Module: Connect (Dating / Social / Professional Networking)

**Risk tier:** mixed — safety & money sub-areas are 0/1; social content is 2 · **Money-path:** partial (gifting, paid voting, payouts, monetization, jobs commission) · **Feature flag:** `FEATURE_CONNECT_ENABLED` (`FeatureConnectEnabled`); money/network route tiers also gated by `FeatureCommissionEnabled`
**Code:** `backend/internal/connect/` (sub-pkgs: profile, verification, matching, discovery, search, onboarding, chat, safety, datesafety, moderation, trust, aml, professional, networking, jobs, feed, mentorship, assessments, events, creator, monetization, gifting, voting, payouts, gamification, live, config) · route wiring `internal/app/connect_routes.go`, `connect_phase1_routes.go`, `connect_money_routes.go`, `connect_network_routes.go`, `connect_live_routes.go`
**Slug:** `CONNECT`

## 1. Overview & scope

A large super-module registered in phases. Group cases by sub-area:
- **Non-money social:** profile, verification, matching, discovery/search, onboarding, chat,
  moderation, trust, feed, networking/jobs/mentorship/assessments.
- **Safety (P0):** identity verification (with a real state machine), AML velocity checks,
  date-safety, underage/age gating, moderation — a defective safety gate is an **S1** issue.
- **Money-path (Tier 1):** gifting (send gifts + catalog), voting (paid-vote contests), payouts
  (creator/host payouts), monetization, jobs commission — inherit
  `../cross-cutting/money-invariants.md`.

Cross-cutting: authentication, RBAC (moderation/admin), money invariants, KYC (payouts).

## 2. Services / endpoints in scope (by sub-area — enumerate exact paths from the route files when scripting)

| Sub-area | Representative operations | Auth | Money? |
|---|---|---|---|
| profile / verification | create/update profile; submit identity verification | member | no |
| discovery / matching | swipe, boost, daily-picks, match | member | no |
| onboarding | age gate, consent, liveness, preferences | member | no |
| chat / safety / datesafety | message, report, block, safety check-in | member | no |
| moderation / trust | queue review, trust-score signals | RBAC | no |
| aml | velocity / risk policy on money actions | system | gate |
| gifting | send gift, gift catalog | member, Idempotency-Key | **yes** |
| voting | paid-vote in contests | member, Idempotency-Key | **yes** |
| payouts | request/settle creator-host payout | owner, KYC-gated | **yes** |
| monetization / jobs | subscriptions, job-post commission | member | **yes** |
| live | broadcaster console, gifts, PK-battle | member | yes (gifts) |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Verification state machine | unit | `internal/connect/verification/statemachine_test.go`, `verification_test.go`, `provider_test.go` | AUTOMATED |
| Matching logic | unit | `internal/connect/matching/matching_test.go` | AUTOMATED |
| Discovery swipe/boost/distance | unit | `internal/connect/discovery/{swipe,boost,distance}_test.go` | AUTOMATED |
| Monetization money logic | unit | `internal/connect/monetization/money_test.go` | AUTOMATED |
| Onboarding age / consent | unit | `internal/connect/onboarding/{age,consent}_test.go` | AUTOMATED |
| Date-safety / safety / moderation models | unit | `datesafety/model_test.go`, `safety/model_test.go`, `moderation/model_test.go` | AUTOMATED |
| Trust detection / AI | unit | `internal/connect/trust/{detect,ai}_test.go` | AUTOMATED |
| Events mask, chat model, profile, creator collab, professional intro | unit | respective `*_test.go` | AUTOMATED |
| Gifting / voting / payouts money integration | int | — | TODO |
| AML velocity enforcement on money | int | — | PARTIAL |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| CONNECT-FSM-001 | Identity verification lifecycle | P0 | member | submit → provider result → verified/rejected/needs-info | — | Only legal transitions (`verification/statemachine_test.go`); verified unlocks gated features |
| CONNECT-SEC-001 | Underage gate blocks signup | P0 | DOB under threshold | Complete onboarding age gate | under-18 DOB | Rejected; no profile created (`onboarding/age_test.go`) |
| CONNECT-SEC-002 | Consent required | P0 | new member | Proceed without consent | — | Blocked until consent captured |
| CONNECT-SEC-003 | Date-safety report/block | P0 | A messaging B | B reports/blocks A | — | A can no longer contact B; report queued to moderation |
| CONNECT-SEC-004 | AML velocity on gifting | P0 | rapid repeated gifts | Send many gifts fast | over-velocity | Throttled/blocked per AML policy; fail-closed |
| CONNECT-INV-001 | Gift send idempotent | P0 | funded member | `send gift` twice same key | same key | Single debit; recipient credited once |
| CONNECT-INV-002 | Paid vote debits once | P0 | funded | Paid-vote twice same key | same key | Single debit; one vote recorded |
| CONNECT-INV-003 | Payout KYC-gated + idempotent | P0 | creator, unverified KYC | Request payout | — | Blocked without KYC; with KYC, single idempotent payout ≤ balance |
| CONNECT-AUTHZ-001 | Profile object-level | P0 | member A, B | B edits A's profile / reads A's private data | — | 403 (IDOR) |
| CONNECT-AUTHZ-002 | Moderation queue RBAC | P0 | `qa-user-a` | Access moderation/trust console | — | 403 unless moderator role |
| CONNECT-INT-001 | Match happy path | P1 | two members | Mutual swipe | — | Match created; chat unlocked |
| CONNECT-CON-001 | Discovery boost bounds | P2 | member | Boost with invalid params | — | 400; valid boost applied within limits |
| CONNECT-SEC-005 | Impersonation / trust signal | P1 | suspicious profile | Trigger trust-detection heuristics | — | Flagged (`trust/detect_test.go`); surfaced to moderation |
| CONNECT-SEC-006 | Flag-off inaccessible | P0 | `FEATURE_CONNECT_ENABLED` off | Call any connect route | — | Not mounted / 404 (FLAG-SEC-001) |
| CONNECT-SEC-007 | Money routes gated by commission flag | P1 | `FeatureCommissionEnabled` off | Call gifting/jobs money route | — | Money/commission routes inaccessible; social features still work |

## 5. State-machine transitions

**Identity verification** (`verification/statemachine.go`): pending → submitted → under_review →
verified | rejected | needs_more_info → (resubmit) → under_review. Verified unlocks
gated/gifting/payout features; rejected grants nothing; re-verify idempotent. Illegal
transitions rejected.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| under_review | approve | verified | features unlocked; audit | CONNECT-FSM-001 |
| under_review | reject | rejected | no unlock | CONNECT-FSM-002 |
| needs_more_info | resubmit | under_review | new evidence | CONNECT-FSM-003 |
| verified | verify again | verified | idempotent | CONNECT-FSM-004 |

## 6. Security & abuse cases

Underage/consent gating; date-safety report/block; AML velocity fail-closed on money; identity
verification integrity; profile IDOR; moderation RBAC; gifting/voting/payout idempotency; payout
KYC gate; trust/impersonation detection; flag + commission-flag gating. Money invariants per
cross-cutting.

## 7. Automated specs to add

- `internal/connect/gifting/money_integration_test.go`, `voting/paid_vote_test.go`,
  `payouts/idempotency_test.go` — idempotent + balanced + KYC gate.
- AML velocity integration test on the money seam (fail-closed).
- Profile IDOR access-control test.

## 8. Coverage target & exit criteria

Safety + money sub-areas P0 green. Exit: underage/consent/date-safety enforced, AML fail-closed,
verification FSM correct, gifting/voting/payouts idempotent + KYC-gated, profile IDOR-proof,
flags gate access.
