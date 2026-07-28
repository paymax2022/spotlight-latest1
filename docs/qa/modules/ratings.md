# Module: Ratings

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** `FEATURE_RATINGS_ENABLED`
**Code:** `backend/internal/finance/ratings/` (`handler.go`, `service.go`, `model.go`, `model_test.go`); mounted in `backend/internal/app/finance_routes.go`
**Slug:** `RATINGS` (uppercase, used in Case IDs)

## 1. Overview & scope

Ratings lets a user score an entity (doctor, pharmacy, restaurant, rider, driver, bus operator, event organiser, campaign, group admin) after a completed transaction, and exposes an aggregated summary (average + count) per entity. One shared `ratings` table backs all entity types. Creation is **idempotent per `(rater_id, transaction_ref)`** via `ON CONFLICT DO NOTHING` — the transaction ref prevents double-rating the same order. No money, no FSM. QA focus: score bounds (1–5), required fields, idempotency, and identity (rater from token, not body). Cross-cutting: `../cross-cutting/authentication.md`, `../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Create rating | `POST /api/finance/ratings` | `requireUserID()` (token → `rater_id`) | no |
| Get summary | `GET /api/finance/ratings/:entity_id?type=<entityType>` | `requireUserID()` | no |

`CreateRequest`: `entity_id` (required), `entity_type` (required), `transaction_ref` (required), `score` (required, `min=1,max=5`), `comment` (optional). `Summary`: `entity_id, entity_type, average, count`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| 9 entity-type constants distinct/non-empty | unit | `internal/finance/ratings/model_test.go` (`TestEntityTypeConstants`) | AUTOMATED |
| Score bounds 1.0–5.0 | unit | `model_test.go` (`TestRatingScoreBounds`) | AUTOMATED |
| Required fields on create | unit | `model_test.go` (`TestCreateRequestRequiredFields`) | AUTOMATED |
| (entity,rater,txn) uniqueness documented | unit | `model_test.go` (`TestTransactionRefPreventsDoubleRating`, doc-level) | PARTIAL |
| Summary count non-negative / avg range | unit | `model_test.go` (`TestSummaryCountNonNegative`) | AUTOMATED |
| Idempotent create against real DB | int | — | TODO |
| Handler auth + query validation | authz/con | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `RATINGS-INT-001` | Create rating happy path | P1 | flag on, `qa-user-a` | `POST /ratings` valid body | score `4.5` | 201; `rater_id`=token id; row persisted |
| `RATINGS-INT-002` | Idempotent per (rater,txn) | P0 | one rating exists | `POST /ratings` same `transaction_ref` | same ref | Idempotent success (no duplicate; `ON CONFLICT DO NOTHING`) |
| `RATINGS-INT-003` | Summary aggregates correctly | P1 | 3 ratings for entity (4,5,3) | `GET /ratings/:id?type=doctor` | — | 200 `{average:4.0, count:3}` |
| `RATINGS-UNIT-001` | Score below 1 rejected | P0 | — | `POST /ratings` score `0.9` | 0.9 | 400 (binding `min=1`) |
| `RATINGS-UNIT-002` | Score above 5 rejected | P0 | — | `POST /ratings` score `5.1` | 5.1 | 400 (binding `max=5`) |
| `RATINGS-UNIT-003` | Missing required field | P1 | — | omit `entity_id`/`entity_type`/`transaction_ref` | missing | 400 |
| `RATINGS-CON-001` | Summary requires type param | P1 | — | `GET /ratings/:id` (no `type`) | — | 400 `type query param required` |
| `RATINGS-CON-002` | Empty summary for unrated entity | P2 | no ratings | `GET /ratings/:id?type=rider` | — | 200 `{average:0, count:0}` |
| `RATINGS-AUTHZ-001` | Rater from token, not body | P0 | A token | `POST /ratings` | — | `rater_id`=A; no body field overrides |
| `RATINGS-AUTHZ-002` | Missing token | P0 | no token | `POST /ratings` | — | 401 (auth layer) — AUTH-UNIT-001 |
| `RATINGS-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_RATINGS_ENABLED` off | `POST /ratings` | — | 404 — FLAG-SEC-001 |
| `RATINGS-SEC-002` | Comment injection sanitized | P2 | — | `POST /ratings` comment with SQL/HTML | payload | Stored as data (parameterized query); no injection; rendered-safe downstream |
| `RATINGS-SEC-003` | Cannot rate arbitrary txn (abuse) | P2 | — | `POST /ratings` `transaction_ref` not owned by rater | foreign ref | Document: no ownership check on `transaction_ref` — abuse/inflation vector to consider (score is still one-per-(rater,ref)) |

## 5. State-machine transitions

Not applicable — no FSM.

## 6. Security & abuse cases

- **Idempotency (`RATINGS-INT-002`):** `UNIQUE(rater_id, transaction_ref)` (model doc notes `(entity_id, rater_id, transaction_ref)`) enforces at-most-once per order; a replay is a benign success (service swallows the conflict).
- **Identity from token (`RATINGS-AUTHZ-001`):** `rater_id = c.GetString("user_id")`; no spoofable body field.
- **Score bounds (`RATINGS-UNIT-001/002`):** gin binding `min=1,max=5` — no server-side re-check beyond binding, so a non-HTTP caller bypassing binding is unconstrained (note for future callers).
- **Rating-inflation abuse (`RATINGS-SEC-003`):** no check that the rater actually transacted the referenced order — a fabricated `transaction_ref` yields a valid rating. Consider gating on a real completed-transaction lookup.
- **Injection (`RATINGS-SEC-002`):** parameterized SQL; comment is data.

## 7. Automated specs to add

- `internal/finance/ratings/handler_test.go` — httptest: score-bound rejection (0.9 / 5.1), missing required fields, missing `type` param, rater-from-token. (RATINGS-UNIT-*, CON-001, AUTHZ-001)
- `internal/finance/ratings/service_test.go` (skip-gated on `TEST_DATABASE_URL`) — idempotent create (`ON CONFLICT`), summary aggregation math against real rows. (RATINGS-INT-002/003)

## 8. Coverage target & exit criteria

Tier-1: pure-logic ≥ 70% (bounds/constants already covered). Exit: score-bound + required-field validation proven at the handler; idempotent create + summary aggregation proven against real DB; rater-from-token proven; flag-off returns 404. Failures here are tracked defects for the ratings feature, not S1 blockers (no money path).
