# Module: Creators (Monetisation)

**Risk tier:** 1 · **Money-path:** yes (tips, content purchase, subscriptions, payouts) · **Feature flag:** `FEATURE_CREATORS_ENABLED` (`FeatureCreatorsEnabled`)
**Code:** `backend/internal/creators/` (`handler.go`, `service.go`, `member_reads.go`, `model.go`) — mounted via `Handler.Register(member, admin, guard)` with a `GuardFunc` permission closure. **No in-package `*_test.go` today (top gap).**
**Slug:** `CREATORS`

## 1. Overview & scope

Phase-3 creator monetisation: apply/verify as a creator, publish paid content and subscription
tiers, receive **tips**, sell **content purchases**, run **subscriptions**, and **request
payouts** of earnings. All value flows credit/debit the wallet ledger — inherits
`../cross-cutting/money-invariants.md`. Admin approve/suspend is guarded by `creators.verify`
(`../cross-cutting/rbac-and-permissions.md`). Member endpoints are token-scoped; object-level
ownership (a creator only manages their own content/tiers/earnings) is P0.

## 2. Services / endpoints in scope (grounded in `handler.go` Register)

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Apply as creator | `POST /creators/apply` | member | no |
| Discover / storefront | `GET /creators-directory`, `/creators/:creatorId` | member | no |
| My content / subscriptions | `GET /my-creator/content`, `/my-creator/subscriptions` | owner | no |
| Tip a creator | `POST /creators/:creatorId/tip` | member, Idempotency-Key | **yes** |
| Create content | `POST /creators/content` | creator (owner) | no |
| Purchase content | `POST /creators/content/:contentId/purchase` | member, Idempotency-Key | **yes** |
| View content | `GET /creators/content/:contentId` | entitled member | gated |
| Create tier | `POST /creators/tiers` | creator (owner) | no |
| Subscribe / cancel | `POST /creators/tiers/:tierId/subscribe`, `/subscriptions/:subId/cancel` | member/owner | **yes** |
| Earnings balance | `GET /creators/earnings/balance` | owner creator | read (kobo) |
| Request payout | `POST /creators/payouts` | owner creator, Idempotency-Key | **yes** |
| Admin approve / suspend | `POST /creators/:creatorId/approve`, `/suspend` | `guard("creators.verify")` | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Tip / purchase / subscribe money flow | int | — | TODO |
| Payout idempotency + ceiling | int | — | TODO |
| Content entitlement gating | unit | — | TODO |
| Admin guard `creators.verify` | int | — | TODO |

> The entire package lacks tests — Section 7 is the priority backlog.

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| CREATORS-INT-001 | Apply → approve → publish | P1 | member, `qa-admin` w/ `creators.verify` | apply → admin approve → create content | — | Only approved creators publish |
| CREATORS-AUTHZ-001 | Admin approve guarded | P0 | `qa-user-a` (no perm) | `POST /creators/:id/approve` | — | 403 (guard `creators.verify`) |
| CREATORS-AUTHZ-002 | Content ownership | P0 | creator A, creator B | B creates content under A / edits A's tier | — | 403 — own resources only |
| CREATORS-INV-001 | Tip idempotent | P0 | funded member | `POST /:id/tip` twice same key | same key | Single debit; creator credited once |
| CREATORS-INV-002 | Content purchase → entitlement | P0 | funded member | Purchase content, then view | kobo | One debit; buyer entitled; non-buyer `GET /content/:id` denied |
| CREATORS-INV-003 | Purchase idempotent | P0 | funded | Double-purchase same key | same key | Single debit; single entitlement |
| CREATORS-INV-004 | Subscribe → recurring entitlement | P1 | funded | Subscribe to tier | kobo | Debit once; subscription active; cancel stops future billing |
| CREATORS-INV-005 | Payout ≤ earnings, idempotent | P0 | creator with balance | `POST /payouts` twice same key | same key | Single payout ≤ balance; balanced ledger |
| CREATORS-INV-006 | Missing Idempotency-Key | P1 | — | tip/purchase/payout without key | — | Rejected (I10) |
| CREATORS-AUTHZ-003 | Earnings visibility | P0 | creator A, B | B reads A's `/earnings/balance` | — | Own balance only |
| CREATORS-SEC-001 | Suspended creator cannot earn | P1 | suspended creator | Attempt payout / receive tip | — | Blocked per suspension |
| CREATORS-SEC-002 | Flag-off inaccessible | P0 | `FEATURE_CREATORS_ENABLED` off | Call any route | — | Not mounted / 404 (FLAG-SEC-001) |

## 5. State-machine transitions

**Creator status:** applied → approved | rejected → suspended → (reinstated). Approve enables
publishing/earning; suspend blocks earning. **Subscription:** active → cancelled (no future
billing). Illegal transitions rejected; re-approve idempotent.

## 6. Security & abuse cases

Admin-guard (`creators.verify`) allowed-vs-denied; content/tier/earnings object-level ownership;
tip/purchase/payout idempotency + payout ceiling; entitlement gating on paid content; suspended
creator lockout; flag-off gating. Money invariants per cross-cutting.

## 7. Automated specs to add

- `internal/creators/service_money_test.go` — tip/purchase/subscribe/payout idempotency +
  balanced ledger + payout ceiling (table-driven).
- `internal/creators/entitlement_test.go` — paid-content access control (buyer vs non-buyer).
- `internal/creators/guard_test.go` — `creators.verify` allowed vs denied.

## 8. Coverage target & exit criteria

Establish coverage from zero; money funcs ≥ 85%. Exit: all money ops idempotent + bounded,
entitlement enforced, admin guard proven, flag gates access.
