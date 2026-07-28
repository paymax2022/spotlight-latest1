# Module: Cashtag Directory

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** none of its own — rides the consumer's flag (HTTP surface behind `FEATURE_SOCIAL_PAY_ENABLED`; also reused by Events / Creators)
**Code:** `backend/internal/cashtag/service.go` (single file); HTTP surface `backend/internal/social/handler.go` (`ClaimHandle`, `ResolveHandle`, `MyHandle`, `Register` ~L313-320); wiring `backend/internal/app/top5_p1_routes.go` (`RegisterSocialPay`, `cashtag.NewService(pool)`) mounted from `backend/internal/app/finance_routes.go:430-431` under `FeatureSocialPayEnabled`.
**Slug:** `CASHTAG` (uppercase, used in Case IDs)

## 1. Overview & scope

Cashtag is the `@username → user_id` identity-mapping directory that backs P2P addressing across
Social Pay, event ticket gifting and creator tips. It is a **pure identity service with no money
path** — no balances, no kobo, no ledger, no `Idempotency-Key`. The service exposes exactly three
operations: **Claim** (assign a handle to a user), **Resolve** (`@handle → user_id`, for
addressing payments), and **HandleFor** (the caller's own handle). There is **no update /
rename / release operation** — a handle is effectively immutable once claimed (see §8 finding).
The core testing concerns are (1) the **uniqueness constraint** — one handle per user AND one
user per handle, enforced by DB unique constraints and surfaced as distinct errors; (2)
**case-insensitivity** — every input is normalized to lowercase before storage and lookup, so
`@JohnDoe` and `@johndoe` are the same handle; (3) the **format + reserved + impersonation
guards**; and (4) **concurrency** on the uniqueness constraint.

The HTTP surface lives inside the Social module, so cashtag is reached under the authenticated
finance group. Applicable cross-cutting files (not repeated here):
`../cross-cutting/authentication.md` (finance group carries `RequireAuthContext` + `requireUserID()`;
Bearer→Supabase; suspended/locked/deleted → 403 account restricted; spoofed body `user_id`
ignored — identity comes from `uid(c)`), `../cross-cutting/rbac-and-permissions.md`, and
`../cross-cutting/feature-flags-and-audit.md` (flag-off → 404 not 500, `FLAG-SEC-001`).
`../cross-cutting/money-invariants.md` and `../cross-cutting/kyc-and-tiers.md` do **not** apply.

## 2. Services / endpoints in scope

The finance group (`/api/finance`, `RequireAuthContext` + `requireUserID()`) passes
`finance.Group("/social")` to `RegisterSocialPay`, and `social.Handler.Register` re-groups
`member.Group("/social")` — so the effective mounted paths carry a **doubled** `/social` segment.
Paths below reflect the real wiring; flag this nesting quirk in the report.

| Operation | Method + path | Service func | Auth / identity | Money-path? |
|---|---|---|---|---|
| Claim a handle | `POST /api/finance/social/social/handle` | `Service.Claim(ctx, uid, handle)` | token `user_id` (self only) | no |
| Resolve a handle → user_id | `GET /api/finance/social/social/handle/:handle` | `Service.Resolve(ctx, handle)` | any authenticated caller (open by design) | no |
| Caller's own handle | `GET /api/finance/social/social/handle/me` | `Service.HandleFor(ctx, uid)` | token `user_id` (self only) | no |

Claim body: `{ "handle": "<string>" }`. Success → 201 `{success:true, handle:{...}}`.
Handler error mapping (`social/handler.go` `ClaimHandle`): `ErrTaken` / `ErrAlreadyClaimed` → **409
Conflict**; `ErrReserved` / `ErrImpersonation` → **403 Forbidden**; any other error → **400**.
`ResolveHandle` / `MyHandle` use `fail()`: `cashtag.ErrNotFound` → **404**, else **400**.

Validation (`service.go`):
- **Normalize** = `lower(trim(trimPrefix(trim(h), "@")))` — trims whitespace, strips a leading `@`,
  lowercases. This is why uniqueness/lookup are **case-insensitive**.
- **handlePattern** = `^[a-z0-9][a-z0-9_]{2,29}$` — total length **3–30**, must start alphanumeric,
  only `[a-z0-9_]` thereafter (validated post-Normalize, so uppercase input is folded first).
- **reserved** = 20 exact names (`paymax, admin, support, official, help, root, system, spotlight,
  wallet, escrow, ajo, savings, security, team, staff, moderator, verify, verified, payment,
  payments`) → `ErrReserved`.
- **impersonation guard** — strip underscores; reject if `stripped == reserved` OR
  (`hasPrefix(stripped, reserved)` AND `len(reserved) >= 5`) → `ErrImpersonation` (e.g.
  `paymax_official` → `paymaxofficial` prefixes `paymax`; `p_a_y_m_a_x` → `paymax`). The `>=5`
  guard means short reserved words (`ajo`, `help`, `root`, `team`) are NOT prefix-protected — see
  CASHTAG-CON-005.

Uniqueness: `INSERT INTO cashtag_handles (id, user_id, handle)`; a unique violation is mapped by
**substring-matching the DB error string** — `uq_cashtag_handle` (or `duplicate key`+`handle`) →
`ErrTaken`; `uq_cashtag_user` → `ErrAlreadyClaimed`. Otherwise wrapped as a generic error
(→ handler 400). Flag this string-matching as fragile (see §6).

## 3. Test matrix by layer

No `cashtag_*_test.go` or `backend/tests/cashtag/` suite exists — the package has **zero direct
tests**. All rows below are TODO. (Cashtag is exercised only indirectly wherever Social/Events
integration tests resolve handles, which do not assert cashtag's own invariants.)

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Claim valid handle → row persisted | int | — | TODO |
| Resolve returns owning user_id; unknown → not found | int | — | TODO |
| Format validation (length / start / charset) | unit | — | TODO |
| Reserved-name rejection | unit | — | TODO |
| Impersonation-padding rejection | unit | — | TODO |
| Normalize / case-insensitivity (`@JohnDoe`==`johndoe`) | unit | — | TODO |
| Uniqueness: second claimer of same handle → `ErrTaken` | inv | — | TODO |
| One-handle-per-user: second claim → `ErrAlreadyClaimed` | inv | — | TODO |
| Concurrent same-handle claims → exactly one wins | inv | — | TODO |
| AuthZ: claim/HandleFor bound to session identity | authz | — | TODO |
| Flag-off → social (and thus cashtag) routes not mounted | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `CASHTAG-INT-001` | Claim a valid handle | P0 | social flag on; `qa-user-a` token, no handle yet | `POST .../handle` | `{handle:"john_doe"}` | 201 `{success:true, handle:{user_id:"qa-user-a", handle:"john_doe"}}`; one `cashtag_handles` row |
| `CASHTAG-INT-002` | Resolve handle → user_id | P0 | `john_doe` owned by `qa-user-a` | `GET .../handle/john_doe` | `:handle=john_doe` | 200 `{success:true, user_id:"qa-user-a"}` |
| `CASHTAG-INT-003` | My handle | P1 | `qa-user-a` owns `john_doe` | `GET .../handle/me` | — | 200 `{success:true, handle:{handle:"john_doe"}}` |
| `CASHTAG-INT-004` | Resolve unknown handle → 404 | P1 | no handle `ghost` | `GET .../handle/ghost` | `:handle=ghost` | 404 `{success:false, error:"cashtag: handle not found"}` (`ErrNotFound`) |
| `CASHTAG-CON-001` | Too short (<3 chars) rejected | P1 | flag on | `POST .../handle` | `{handle:"ab"}` | 400; not persisted (fails `handlePattern`) |
| `CASHTAG-CON-002` | Too long (>30 chars) rejected | P1 | flag on | `POST .../handle` | 31-char handle | 400; not persisted |
| `CASHTAG-CON-003` | Illegal charset / bad start rejected | P1 | flag on | Claim `"john-doe"` (hyphen), `"_john"` (leading underscore), `"joh n"` (space) | each | 400 each; only `[a-z0-9_]` allowed and must start alphanumeric |
| `CASHTAG-CON-004` | Empty / whitespace / bare `@` rejected | P1 | flag on | Claim `"@"`, `"  "`, `""` | each | 400 (Normalize → empty → fails pattern); Resolve of empty → `ErrNotFound`/404 |
| `CASHTAG-CON-005` | Short-reserved prefix is NOT impersonation-blocked (boundary) | P2 | flag on | Claim `"ajo123"`, `"helpdesk"` | `ajo`(3)/`help`(4) reserved but `<5` | **Claim succeeds (201)** — documents the `len(reserved)>=5` prefix-guard boundary. Confirm this is intended; if `ajo*`/`help*` should be blocked, the guard needs the short reserved words handled |
| `CASHTAG-SEC-001` | Reserved exact name rejected | P0 | flag on | Claim `"paymax"`, `"admin"`, `"wallet"` | each reserved | 403 `ErrReserved`; not persisted |
| `CASHTAG-SEC-002` | Impersonation padding rejected | P0 | flag on | Claim `"paymax_official"`, `"p_a_y_m_a_x"`, `"paymaxx"` | each | 403 `ErrImpersonation`; not persisted (underscore-strip + `>=5` prefix guard) |
| `CASHTAG-INV-001` | Two users, same handle → second rejected | P0 | `qa-user-a` owns `payme` | `qa-user-b` claims `payme` | `{handle:"payme"}` | 409 `ErrTaken`; `payme` still resolves to `qa-user-a`; no second row |
| `CASHTAG-INV-002` | Case-insensitive collision | P0 | `qa-user-a` owns `payme` (stored lowercased) | `qa-user-b` claims `"PayMe"` / `"@PAYME"` | mixed case | 409 `ErrTaken` — Normalize folds to `payme`, hits `uq_cashtag_handle` |
| `CASHTAG-INV-003` | One handle per user | P0 | `qa-user-a` already owns `john_doe` | `qa-user-a` claims a second handle `johnny` | `{handle:"johnny"}` | 409 `ErrAlreadyClaimed` (`uq_cashtag_user`); still only `john_doe` |
| `CASHTAG-INV-004` | Concurrent same-handle claims → exactly one wins | P0 | handle `hotname` unclaimed; two distinct users | Fire N=10 concurrent `Claim(userX, "hotname")` across users | same handle | Exactly one 201; all others 409 `ErrTaken`; exactly one `cashtag_handles` row for `hotname` (DB unique constraint is the arbiter — no app-level lock) |
| `CASHTAG-AUTHZ-001` | Unauthenticated claim rejected | P0 | no/invalid token | `POST .../handle` | valid body | 401 (finance group `RequireAuthContext` + `requireUserID()`); nothing persisted. Service also guards empty `userID` → `"cashtag: user required"` |
| `CASHTAG-AUTHZ-002` | Suspended account blocked | P0 | `qa-suspended`, valid token | `POST .../handle` | valid | 403 account restricted (`../cross-cutting/authentication.md` AUTH-SEC-001) |
| `CASHTAG-AUTHZ-003` | Identity from token, not body (IDOR) | P0 | `qa-user-a` token | Claim with extra `user_id:"qa-user-b"` in body | body includes victim id | Handle bound to `qa-user-a` (`uid(c)`); body `user_id` ignored. `HandleFor` returns only caller's own handle. Note `Resolve` is intentionally open — any authenticated caller may map any handle→user_id for P2P addressing (not a leak of private data beyond user_id) |
| `CASHTAG-SEC-003` | Flag off → routes not mounted | P0 | `FEATURE_SOCIAL_PAY_ENABLED=false` | `POST .../handle`, `GET .../handle/me` | valid | 404 — `RegisterSocialPay` (the only HTTP mount of cashtag here) is never called; never 500 (`../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001). **N.B. cashtag has no flag of its own**; if it were mounted by another consumer (events/creators) those flags gate independently — verify each surface |

## 5. State-machine transitions

Not applicable — a handle has no lifecycle. There is no update/rename/release operation; a claim
either succeeds once or is rejected. The only "transition" is unclaimed → claimed, guarded by the
DB unique constraints (covered by CASHTAG-INV-001/003/004).

## 6. Security & abuse cases

- **Uniqueness bypass / race** — CASHTAG-INV-001/002/003/004; correctness rests entirely on the
  DB `uq_cashtag_handle` / `uq_cashtag_user` constraints, not on any app-level read-then-write, so
  concurrent claims cannot both win.
- **Fragile error classification (FINDING)** — `Claim` distinguishes taken-vs-already-claimed by
  **substring-matching the raw DB error text** (`uq_cashtag_handle`, `duplicate key`,
  `uq_cashtag_user`). If the migration names the constraints differently, a genuine unique
  violation falls through to the generic wrapped error → handler **400** instead of 409, and the
  intended `ErrTaken`/`ErrAlreadyClaimed` semantics are lost. Add a test that asserts the real
  constraint names match these strings, and prefer matching on `pgconn.PgError.ConstraintName`.
- **Reserved / impersonation abuse** — CASHTAG-SEC-001/002; plus the CASHTAG-CON-005 boundary gap
  where short reserved words (`ajo`, `help`, `root`, `team`) are not prefix-protected.
- **Identity spoofing / IDOR** — CASHTAG-AUTHZ-003; claim/own-handle bound to token identity;
  `Resolve` is intentionally open (addressing primitive).
- **No money / tier / KYC / idempotency** — assert their absence; cashtag moves no funds and has
  no `Idempotency-Key`. (The consuming Social P2P money path enforces those separately — out of
  scope here.)
- **Fail-closed on flag off** — CASHTAG-SEC-003.

## 7. Automated specs to add

- `internal/cashtag/validate_test.go` — table-driven Go over `Normalize` + `Validate`: case
  folding (`@JohnDoe`→`johndoe`), `@`/whitespace trimming, length boundaries (2 reject / 3 accept
  / 30 accept / 31 reject), charset + leading-char rules, every reserved word → `ErrReserved`,
  impersonation cases (`paymax_official`, `p_a_y_m_a_x`, `paymaxx`) → `ErrImpersonation`, and the
  CASHTAG-CON-005 boundary (`ajo123`/`helpdesk`) documenting current behavior. Pure-logic, no DB.
- `backend/tests/cashtag/uniqueness_test.go` — DB-backed (gated on `TEST_DATABASE_URL`): claim +
  resolve round trip; same-handle second user → `ErrTaken`; case-insensitive collision; same-user
  second claim → `ErrAlreadyClaimed`; **N-concurrent same-handle claims → exactly one row**
  (goroutines + `sync.WaitGroup`, assert one success and one row). Mirrors the house live-DB
  pattern (skip-gated).
- `backend/tests/cashtag/constraint_names_test.go` — assert the actual DB constraint names
  contain `uq_cashtag_handle` / `uq_cashtag_user` so the error-string mapping in `Claim` cannot
  silently rot (guards the §6 fragility finding).

## 8. Coverage target & exit criteria

Tier-2, currently **zero** direct coverage. Priority is the validation unit table (§7, cheap,
DB-free, highest value) plus the DB-backed uniqueness + concurrency suite. **Exit criteria (must
pass before release):** CASHTAG-INT-001, CASHTAG-INT-002, CASHTAG-INV-001, CASHTAG-INV-002,
CASHTAG-INV-003, CASHTAG-INV-004, CASHTAG-SEC-001, CASHTAG-SEC-002, CASHTAG-AUTHZ-001,
CASHTAG-SEC-003. Tracked findings to resolve or explicitly accept: (a) the fragile DB-error
string matching in `Claim` (§6); (b) the short-reserved-word impersonation gap (CASHTAG-CON-005);
(c) the doubled `/social/social` route path from nested route groups; (d) the absence of any
handle rename/release operation — confirm handles are intended to be permanently immutable.
