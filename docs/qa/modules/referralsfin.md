# Module: Referrals (Finance-side rewards)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes (reward credits + refund reversals) &nbsp;·&nbsp; **Feature flags:** `FEATURE_REFERRALS_ENABLED` (legacy summary) · `FEATURE_REFERRAL_REWARDS_ENABLED` (Direct Rewards engine)
**Code:** `backend/internal/finance/referrals/` (`handler.go`, `service.go`, `model.go`, `model_test.go`, `rewards_handler.go`, `rewards_service.go`, `rewards_model.go`, `rewards_model_test.go`); mounted in `backend/internal/app/finance_routes.go` + `referral_rewards_routes.go`
**Slug:** `REFERRALSFIN` (uppercase, used in Case IDs)

## 1. Overview & scope

Two coexisting surfaces (additive brownfield). (1) **Legacy**: `GET /api/finance/referrals/me` returns a referral summary (under `FEATURE_REFERRALS_ENABLED`). (2) **Direct Referral Rewards engine** (under `FEATURE_REFERRAL_REWARDS_ENABLED`): a single-level, purchase-triggered revenue share. On a settled purchase by a referred user, revenue-bearing modules emit `PurchaseSettled` (via in-process hook or `POST /internal/referrals/purchase-settled`); the engine computes `floor(margin × tier-rate)`, inserts one reward per `source_transaction_id` (UNIQUE), and **credits the referrer wallet via a balanced ledger `Credit`** keyed on the reward id. A refund emits `PurchaseRefunded` → balanced `PostReversal`. A nightly recalc updates tiers and pays milestone bonuses idempotently. There is **no user withdraw endpoint** — rewards credit the wallet directly (withdrawal happens through the wallet/transfers modules). Three route classes: user `/v1/referrals/*` (Bearer, own-data authZ), admin `/v1/admin/referrals/*` (per-route RBAC `referral.admin.*`), internal `/internal/referrals/*` (X-Internal-Secret, fail-closed). Cross-cutting: `../cross-cutting/money-invariants.md`, `../cross-cutting/rbac-and-permissions.md`, `../cross-cutting/webhooks-and-providers.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Legacy summary | `GET /api/finance/referrals/me` | token | no |
| Get/create link | `POST /v1/referrals/link` | token (own) | no |
| Attribute code (signup) | `POST /v1/referrals/attribute` | token (own) | no |
| Dashboard / referrals / earnings / milestones | `GET /v1/referrals/me/*` | token (own) | no |
| Purchase settled (emit) | `POST /internal/referrals/purchase-settled` | `X-Internal-Secret` | yes (credit) |
| Purchase refunded (emit) | `POST /internal/referrals/purchase-refunded` | `X-Internal-Secret` | yes (reversal) |
| Recalc tiers | `POST /internal/referrals/recalc-tiers` | `X-Internal-Secret` | yes (milestone payout) |
| Admin config (get/publish) | `GET/PUT /v1/admin/referrals/config` | `referral.admin.config` | no |
| Admin analytics / fraud / ledger / case / milestones / module | `GET/POST /v1/admin/referrals/*` | per-route `referral.admin.*` | case-adjust: yes |

`PurchaseSettled{module, transaction_id, payer_user_id, margin_kobo, currency, settled_at}`; `PurchaseRefunded{transaction_id, refunded_at}`. `ComputeReward(marginKobo, rate) = floor(margin × rate)` (integer kobo). Reward status: `PENDING`, `CREDITED`, `REVERSED`. Milestone status: `ACHIEVED`, `PAID`, `VOIDED`. Ledger keys: credit `referral:reward:<rewardID>`, reversal `referral:reward-reversal:<rewardID>`, milestone `referral:milestone:<referrer>:<threshold>`; expense account `AccountReferralReward`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Reward amount kobo / positive / whole | unit | `internal/finance/referrals/model_test.go` (`TestRewardAmountKobo`, `_IsPositive`, `_IsWholeNaira`) | AUTOMATED |
| Self-referral contract | unit | `model_test.go` (`TestSelfReferralContract`) | AUTOMATED |
| Code structure / summary invariants | unit | `model_test.go` (`TestCodeStructure`, `TestSummaryInvariants`) | AUTOMATED |
| Tier band resolution (min/max/open-ended) | unit | `rewards_model_test.go` (`TestTierForCount`) | AUTOMATED |
| ComputeReward floor + never exceeds margin | inv | `rewards_model_test.go` (`TestComputeReward`, `TestComputeRewardNeverExceedsMargin`) | AUTOMATED |
| Milestone kobo values | unit | `rewards_model_test.go` (`TestMilestoneKoboValues`) | AUTOMATED |
| PurchaseSettled contract / status constants | unit | `rewards_model_test.go` (`TestPurchaseSettledContract`, `TestStatusConstants`) | AUTOMATED |
| Config effective-from forward-only | unit | `rewards_model_test.go` (`TestConfigEffectiveFromForwardOnly`) | AUTOMATED |
| Reward credit idempotent (real ledger) | inv | — | TODO |
| Refund reversal balanced + idempotent | inv | — | TODO |
| Internal-secret fail-closed | sec | — (guard in handler) | TODO |
| Admin RBAC per-route | authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `REFERRALSFIN-INV-001` | Settled purchase credits referrer | P0 | flag on, attributed referrer, secret set | `POST /internal/referrals/purchase-settled` | `margin_kobo=100_000`, rate 0.05 | Reward `floor(100000*0.05)=5000`; referrer wallet credited `5000` via balanced ledger; reward `CREDITED` |
| `REFERRALSFIN-INV-002` | ComputeReward floors | P0 | rate 0.05 | emit `margin_kobo=100_003` | odd | `floor(100003*0.05)=5000` (kobo, floored) |
| `REFERRALSFIN-INV-003` | Reward never exceeds margin | P0 | rate ≤ 1 | emit various margins | — | `reward ≤ margin` for all cases |
| `REFERRALSFIN-INV-004` | Settled idempotent per transaction | P0 | reward exists | emit same `transaction_id` again | same txn | No second reward/credit (`source_transaction_id` UNIQUE; CREDITED → no-op) — MONEY-INV-006 |
| `REFERRALSFIN-INV-005` | Refund reverses credited reward | P0 | reward CREDITED | `POST /internal/referrals/purchase-refunded` | matching txn | Balanced `PostReversal` drains reward from wallet → expense; reward `REVERSED` |
| `REFERRALSFIN-INV-006` | Refund idempotent / uncredited no-op | P0 | reward PENDING or already REVERSED | emit refund again | — | No reversal (status guard); no double-drain — MONEY-INV-010 |
| `REFERRALSFIN-INV-007` | Zero-value reward skips ledger | P1 | margin small / rate 0 | emit settled | reward 0 | No ledger post; reward still resolves CREDITED (no double count) |
| `REFERRALSFIN-INV-008` | Milestone payout idempotent | P1 | threshold crossed | run recalc twice | — | Milestone ACHIEVED→PAID once; bonus credited once (idempotency_key + ledger key) |
| `REFERRALSFIN-UNIT-001` | Self-referral rejected | P0 | — | `POST /v1/referrals/attribute` own code | self | `self-referral rejected`; no attribution |
| `REFERRALSFIN-UNIT-002` | Attribute idempotent per user | P1 | already attributed | `POST /attribute` again | — | Returns existing referrer; no re-attribution (`referred_user_id` UNIQUE) |
| `REFERRALSFIN-UNIT-003` | Unknown code rejected | P1 | — | `POST /attribute` bad code | unknown | 400 error; no attribution |
| `REFERRALSFIN-SEC-001` | Internal endpoint no secret → 503 | P0 | `ReferralRewardsInternalSecret=""` | `POST /internal/referrals/purchase-settled` | — | 503 `internal endpoint disabled` (fail-closed) |
| `REFERRALSFIN-SEC-002` | Internal endpoint wrong secret → 401 | P0 | secret set | POST with wrong `X-Internal-Secret` | wrong | 401 `invalid internal secret` (constant-time compare) |
| `REFERRALSFIN-SEC-003` | Internal endpoint valid secret | P0 | secret set | POST with correct `X-Internal-Secret` | correct | 200; event processed |
| `REFERRALSFIN-AUTHZ-001` | User routes own-data only (IDOR) | P0 | A and B | B `GET /v1/referrals/me/earnings` | B token | Only B's rewards; `uid` from token, no override — RBAC-AUTHZ-007 |
| `REFERRALSFIN-AUTHZ-002` | Admin config denied w/o perm | P0 | non-admin | `GET /v1/admin/referrals/config` | — | 403 `forbidden` — RBAC-AUTHZ-001 |
| `REFERRALSFIN-AUTHZ-003` | Admin config allowed w/ perm | P0 | holds `referral.admin.config` | same | — | 200 |
| `REFERRALSFIN-AUTHZ-004` | Per-route RBAC (fraud/ledger/case distinct) | P1 | holds only `referral.admin.config` | `GET /v1/admin/referrals/fraud-queue` | — | 403 (needs `referral.admin.fraud`, not config) |
| `REFERRALSFIN-AUTHZ-005` | RBAC fail-closed on error | P0 | force CheckPermission error | any admin route | — | 403 (never allow-on-error) — RBAC-AUTHZ-004 |
| `REFERRALSFIN-SEC-004` | Case adjust requires Idempotency-Key | P0 | admin holds `referral.admin.case` | `POST /v1/admin/referrals/:id/case` no header | none | 400 `Idempotency-Key header required` |
| `REFERRALSFIN-SEC-005` | Config publish forward-only | P1 | admin | `PUT /v1/admin/referrals/config` | new version | Applies to future txns only; past rewards not recomputed (warning surfaced) |
| `REFERRALSFIN-SEC-006` | Flags off → routes not mounted | P0 | both referral flags off | `GET /api/finance/referrals/me`, `POST /v1/referrals/link` | — | 404 — FLAG-SEC-001 |

## 5. State-machine transitions

| Machine | From | Event | To | Side effect | Case ID |
|---|---|---|---|---|---|
| Reward | (none) | `OnPurchaseSettled` | `PENDING` | reward row inserted (UNIQUE source txn) | `REFERRALSFIN-INV-001` |
| Reward | `PENDING` | credit posted | `CREDITED` | balanced `Credit` to referrer wallet | `REFERRALSFIN-INV-001` |
| Reward | `CREDITED` | `OnPurchaseRefunded` | `REVERSED` | balanced `PostReversal` drains wallet | `REFERRALSFIN-INV-005` |
| Reward | `PENDING`/`REVERSED` | refund | — (no-op) | idempotent guard (`status != CREDITED`) | `REFERRALSFIN-INV-006` |
| Reward | `CREDITED` | settle replay | — (no-op) | idempotent (already processed) | `REFERRALSFIN-INV-004` |
| Milestone | (none) | recalc crossing | `ACHIEVED` | inserted idempotently (referrer+threshold) | `REFERRALSFIN-INV-008` |
| Milestone | `ACHIEVED` | payout | `PAID` | one-time bonus credited | `REFERRALSFIN-INV-008` |

Illegal / guarded: refunding an uncredited reward, double-crediting a settled reward, and re-awarding a paid milestone are all idempotent no-ops (not errors).

## 6. Security & abuse cases

- **Internal-secret fail-closed (`REFERRALSFIN-SEC-001/002/003`):** empty secret → 503; wrong secret → 401 (constant-time). A purchase event can never be accepted unauthenticated.
- **Self-referral / attribution abuse (`REFERRALSFIN-UNIT-001/002/003`):** self-referral rejected fail-closed; attribution idempotent per user; unknown codes rejected — prevents reward farming.
- **Idempotent money (`REFERRALSFIN-INV-004/006/008`):** one reward per `source_transaction_id`; refund only from `CREDITED`; milestone payout keyed — no double-credit / double-drain.
- **Balanced reversal (`REFERRALSFIN-INV-005`):** `PostReversal` restores the exact reward from wallet → expense; append-only — `../cross-cutting/money-invariants.md` I7/I8.
- **Per-route admin RBAC (`REFERRALSFIN-AUTHZ-002..005`):** each admin route carries its own `referral.admin.*` permission; deny-by-default + fail-closed.
- **Object-level authZ (`REFERRALSFIN-AUTHZ-001`):** user routes derive `uid` from token; masked contact on referred-user lists.
- **Config forward-only (`REFERRALSFIN-SEC-005`):** rate/milestone changes never retroactively recompute past rewards.

## 7. Automated specs to add

- `internal/finance/referrals/rewards_service_test.go` (skip-gated on `TEST_DATABASE_URL`) — real ledger: settled→credit idempotent, refund→balanced reversal idempotent, zero-value skip, milestone payout idempotency (`REFERRALSFIN-INV-001..008`). (gap G5)
- `internal/finance/referrals/rewards_handler_test.go` — internal-secret fail-closed (empty/wrong/valid), user-route own-data scoping, case-adjust Idempotency-Key requirement (`REFERRALSFIN-SEC-001..004`, `AUTHZ-001`).
- `internal/app/referral_rewards_routes_authz_test.go` — per-route RBAC matrix (`referral.admin.config` vs `.fraud` vs `.case` …) + fail-closed (`REFERRALSFIN-AUTHZ-002..005`).

## 8. Coverage target & exit criteria

Tier-1 money-path: pure-logic ≥ 80% (reward math + tier bands already covered). Exit: reward credit idempotency + refund reversal balanced/idempotent proven on real ledger; internal-secret fail-closed proven; per-route admin RBAC + fail-closed proven; self-referral + attribution idempotency proven; flags-off return 404. A double-credit, un-reversed refund, or accepted unauthenticated purchase event is a release blocker.
