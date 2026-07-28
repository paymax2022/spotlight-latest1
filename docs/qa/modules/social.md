# Module: Social (Social Pay)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_SOCIAL_PAY_ENABLED`
**Code:** `backend/internal/social/` — `handler.go`, `service.go`, `aml.go`, `model.go`, `member_lists.go`. Mounted in `backend/internal/app/top5_p1_routes.go` (`RegisterSocialPay`): member routes under `finance.Group("/social")` → `/api/finance/social/*`; admin under `/api/social/admin/*` (guard `social.admin.view`). Uses `cashtag` for handle resolution and `finance/ledger` for money.
**Slug:** `SOCIAL` (uppercase, used in Case IDs)

## 1. Overview & scope

Social Pay is peer-to-peer money over cashtags: **direct send**, **money requests**, **split bills**, and **group pools**, plus a cashtag directory (claim/resolve/me) and read-only activity/list feeds. All money moves wallet→wallet through the finance ledger via an escrow standing account as neutral transit (net-zero, no yield — NL-2), keyed idempotently (NL-9), and gated by **AML velocity limits** (NL-10): single-send cap ₦200,000, rolling-24h count 50, rolling-24h amount ₦500,000 — fail-closed on any AML query error. **Object-level authZ is enforced in every method** using the token identity: you cannot request as someone else, cannot pay a request not addressed to you, cannot pay another user's split share, cannot pay out a pool you do not own, cannot read a split you are not a participant in. Testing priorities: send/request/split/pool money moves + conservation, request/pool state guards, split conservation (shares sum to total), AML fail-closed, and pervasive IDOR. Cross-cutting: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `kyc-and-tiers.md`, `feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Claim cashtag | `POST /social/handle` `{handle}` | member (owner = token) | no |
| My handle | `GET /social/handle/me` | member | no |
| Resolve handle | `GET /social/handle/:handle` | member | no |
| Activity feed | `GET /social/activity?limit=` | member (own) | no |
| Send P2P | `POST /social/send` `{handle, amount_kobo, note}` + `Idempotency-Key` | member (sender = token) | **yes** |
| List requests | `GET /social/requests?limit=` | member (own) | no |
| Create request | `POST /social/requests` `{handle, amount_kobo, note}` | member (requester = token) | no |
| Pay request | `POST /social/requests/:id/pay` | member; **only named payer** | **yes** |
| Decline request | `POST /social/requests/:id/decline` | member; **only payer** | no |
| Cancel request | `POST /social/requests/:id/cancel` | member; **only requester** | no |
| List splits | `GET /social/splits?limit=` | member (own) | no |
| Create split | `POST /social/splits` `{title, total_kobo, mode, shares[]}` | member (organiser = token) | no (creates share requests) |
| Get split | `GET /social/splits/:id` | member; **participant only** | no |
| Pay share | `POST /social/splits/:id/shares/:shareId/pay` + `Idempotency-Key` | member; **only that share's owner** | **yes** |
| List pools | `GET /social/pools?limit=` | member (own) | no |
| Create pool | `POST /social/pools` `{title, beneficiary_id?}` | member (organiser = token) | no |
| Pool balance | `GET /social/pools/:id/balance` | member | no (read) |
| Contribute pool | `POST /social/pools/:id/contribute` `{amount_kobo}` + `Idempotency-Key` | member | **yes** |
| Pay out pool | `POST /social/pools/:id/payout` + `Idempotency-Key` | member; **organiser only** | **yes** |
| Admin view split | `GET /api/social/admin/splits/:id` | `RequirePermission("social.admin.view")` | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| AML single/count/amount caps + fail-closed on query error | inv/sec | — (logic in `aml.go`) | TODO |
| Request transition map (PENDING→PAID/DECLINED/CANCELLED; terminals closed) | fsm | — (map in `model.go`) | TODO |
| Pool transition map (OPEN→PAID_OUT/CLOSED; PAID_OUT→CLOSED) | fsm | — (map in `model.go`) | TODO |
| Split EQUAL remainder to last share; CUSTOM shares sum == total (conservation) | inv | — | TODO |
| Send/PayRequest/PayShare/Contribute/Payout money moves + idempotency | inv/int | — | TODO |
| Object-level authZ (request payer, share owner, pool owner, split participant) | authz | — | TODO |
| Flag-off route inaccessible | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `SOCIAL-INT-001` | Send P2P (happy) | P0 | A funded; B has cashtag | `POST /social/send {handle:@b, amount_kobo}` + key | `amount_kobo=100000`, key `k1` | 200; A −`100000`, B +`100000`; escrow transit nets 0; `social_payments` row |
| `SOCIAL-INT-002` | Claim + resolve cashtag | P2 | A no handle | `POST /social/handle {handle:@a}` then resolve | unique handle | 201; resolve returns A's `user_id`; duplicate claim → 409; reserved/impersonation → 403 |
| `SOCIAL-INT-003` | Create + pay request (happy) | P0 | A requester, B payer, B funded | A `POST /requests {handle:@b, amount_kobo}`; B `POST /requests/:id/pay` | `amount_kobo=50000` | request PENDING→PAID; B −`50000`, A +`50000`; keyed on request id |
| `SOCIAL-INT-004` | Split EQUAL remainder | P1 | organiser A, 3 participants | `POST /splits {total_kobo:10000, mode:EQUAL, shares:[3]}` | `10000/3` | shares `3333,3333,3334`; sum == `10000`; organiser's own share auto-PAID |
| `SOCIAL-INT-005` | Split CUSTOM must sum to total | P0 | organiser A | `POST /splits {total_kobo:10000, mode:CUSTOM, shares sum 9000}` | `9000 != 10000` | 400 "custom shares must sum to total"; nothing created (conservation) |
| `SOCIAL-INT-006` | Pay share settles bill | P1 | split OPEN, one PENDING share owned by B | B `POST /splits/:id/shares/:shareId/pay` + key | — | share PENDING→PAID; B→organiser transfer; when no PENDING remain, bill OPEN→SETTLED |
| `SOCIAL-INT-007` | Pool contribute + payout | P0 | pool OPEN, organiser A, contributors | contribute ×2 then A `POST /pools/:id/payout` + key | contrib `20000`+`30000` | balance `50000` then `0` after payout; beneficiary +`50000`; drain recorded as negative contribution (NL-8) |
| `SOCIAL-INV-001` | Send idempotent replay | P0 | one send key `k1` | repeat `POST /send` with `k1` | same key | returns existing payment; no second debit (MONEY-INV-006) |
| `SOCIAL-INV-002` | Contribute idempotent | P0 | one contribution key `kc` | repeat contribute with `kc` | same key | `ON CONFLICT DO NOTHING`; balance unchanged on replay |
| `SOCIAL-INV-003` | Payout idempotent / re-entry safe | P0 | pool already PAID_OUT | `POST /pools/:id/payout` again | — | Transition guarded (OPEN-only update RowsAffected=0) → rejected; no second credit (MONEY-INV-010) |
| `SOCIAL-SEC-001` | Missing Idempotency-Key on send | P0 | A funded | `POST /send` no header | no key | 400 "Idempotency-Key required" (MONEY-INV-008) |
| `SOCIAL-SEC-002` | Self-send rejected | P0 | A funded | send to own handle | sender==recipient | 400 "cannot send to yourself"; no money moved |
| `SOCIAL-SEC-003` | AML single-send cap | P0 | A funded | send `amount_kobo=20000001` | `> ₦200,000` | 429 `ErrAMLSingleLimit`; no money moved |
| `SOCIAL-SEC-004` | AML rolling-24h count/amount cap | P0 | A near caps | send breaching count (50) or amount (₦500k/24h) | — | 429 `ErrAMLCountLimit` / `ErrAMLAmountLimit` |
| `SOCIAL-SEC-005` | AML query error fails closed | P0 | AML query errors | attempt send | dependency error | Blocked (not allowed) — "fail-closed" (MONEY-INV-012) |
| `SOCIAL-AUTHZ-001` | Only named payer can pay request | P0 | request addressed to B | C calls `POST /requests/:id/pay` | C != payer | 403 `ErrForbidden`; no money moved |
| `SOCIAL-AUTHZ-002` | Only requester can cancel; only payer can decline | P1 | request PENDING | payer cancels / requester declines | wrong actor | 403 `ErrForbidden` |
| `SOCIAL-AUTHZ-003` | Only share owner can pay share (IDOR) | P0 | share owned by B | C pays B's share | C != share.user_id | 403 `ErrForbidden` |
| `SOCIAL-AUTHZ-004` | Only pool organiser can payout (IDOR) | P0 | pool owned by A | B calls payout | B != organiser | 403 `ErrForbidden`; no drain |
| `SOCIAL-AUTHZ-005` | Non-participant cannot view split | P0 | split with A,B | C `GET /splits/:id` | C not a participant | 403 "not a participant" (`IsSplitParticipant`) |
| `SOCIAL-AUTHZ-006` | Admin split view requires perm | P1 | caller lacking perm | `GET /api/social/admin/splits/:id` | no grant | 403 (see `../cross-cutting/rbac-and-permissions.md`) |
| `SOCIAL-SEC-006` | Flag-off inaccessible | P0 | `FEATURE_SOCIAL_PAY_ENABLED=off` | call any `/social/*` route | — | Route not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions (only if the module has an FSM)

Three lifecycles. Legal transitions per the maps in `model.go`; illegal ones must be rejected and terminal states are closed (idempotent re-entry via guarded `WHERE state='...'` updates that no-op with `RowsAffected=0`).

**Money request** (`requestTransitions`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `PENDING` | payer pays | `PAID` | escrow debit payer / credit requester; keyed on request id | `SOCIAL-FSM-001` |
| `PENDING` | payer declines | `DECLINED` | no money | `SOCIAL-FSM-002` |
| `PENDING` | requester cancels | `CANCELLED` | no money | `SOCIAL-FSM-003` |
| `PAID`/`DECLINED`/`CANCELLED` | any | — | rejected (terminal); no-op | `SOCIAL-FSM-004` |

**Split share / bill:**

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| share `PENDING` | owner pays | share `PAID` | debit owner / credit organiser | `SOCIAL-FSM-005` |
| share `PAID` | pay again | `PAID` (idempotent) | no second transfer | `SOCIAL-FSM-006` |
| bill `OPEN` | last pending share paid | `SETTLED` | bill closed | `SOCIAL-FSM-007` |

**Group pool** (`poolTransitions`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `OPEN` | organiser pays out | `PAID_OUT` | credit beneficiary balance; negative drain row | `SOCIAL-FSM-008` |
| `OPEN`/`PAID_OUT` | close | `CLOSED` | terminal | `SOCIAL-FSM-009` |
| `PAID_OUT` | pay out again | — | rejected (`cannot pay out from PAID_OUT`); no double-credit | `SOCIAL-FSM-010` |
| `CLOSED` | any | — | rejected | `SOCIAL-FSM-011` |

## 6. Security & abuse cases

- **Pervasive IDOR** is the module's headline risk — `SOCIAL-AUTHZ-001..005` cover payer/requester/share-owner/pool-owner/participant checks, all keyed off the token identity (`uid(c)`), never a client body id.
- **Split conservation:** CUSTOM shares must sum to total (`SOCIAL-INT-005`); EQUAL puts the remainder on the last share (`SOCIAL-INT-004`) — assert kobo-exact, no minted/lost kobo.
- **AML fail-closed:** single/count/amount caps and DB-error blocking (`SOCIAL-SEC-003/004/005`).
- **Idempotency + terminal re-entry:** `SOCIAL-INV-001/002/003` + FSM no-op guards prevent double-charge/double-payout.
- **Audit actor identity:** `s.log` records the token actor (AUDIT-SEC-001).
- Inherit `../cross-cutting/money-invariants.md` (I1–I12) and `../cross-cutting/kyc-and-tiers.md` tier limits per money endpoint.

## 7. Automated specs to add

- `internal/social/aml_test.go` — table-driven caps + fail-closed-on-error with a stub pool (`SOCIAL-SEC-003/004/005`). TODO.
- `internal/social/fsm_test.go` — `requestTransitions` + `poolTransitions` legal/illegal matrices incl. terminal re-entry (`SOCIAL-FSM-*`). TODO.
- `internal/social/split_math_test.go` — EQUAL remainder + CUSTOM-sum conservation, kobo-exact (`SOCIAL-INT-004/005`). TODO.
- `internal/social/social_live_db_test.go` — live-DB: send/pay-request/pay-share/contribute/payout money moves + idempotent replay + IDOR denials + escrow net-zero. TODO.

## 8. Coverage target & exit criteria

Tier-0 pure-logic floor ≥ 85% (AML, FSM maps, split math). Exit criteria: `SOCIAL-INT-001/003/007` (send/request/pool happy), `SOCIAL-INV-001/003` (replay, payout re-entry), `SOCIAL-SEC-001/002/005` (key, self-send, AML fail-closed), `SOCIAL-AUTHZ-001/003/004/005` (IDOR), and `SOCIAL-INT-005` (split conservation) all green; flag-off `SOCIAL-SEC-006` verified; no S1 open.
