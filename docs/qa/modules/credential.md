# Module: Credential (rotating-QR / NFC gate-entry primitive)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no (identity + single-use only; all money lives in `finance/escrow`) &nbsp;·&nbsp; **Feature flag:** none of its own — gated at the caller (`FEATURE_EVENTS_ENABLED` for ticketing/POS/wallet-band, `FEATURE_LOYALTY_ENABLED` for perk redemption)
**Code:** `backend/internal/credential/` — `model.go` (`Kind`, `State`, `Policy`, `Credential`, `Token`, `Gate`, `Result`, reason constants), `service.go` (`Service` + `Issue`/`CurrentToken`/`Validate`/`EnqueueOffline`/`Reconcile`/`Revoke` + token crypto). **No `handler.go`/`routes.go` — this is a pure internal library.** Callers: `internal/top5events/service.go` (ticket gate `ScanTicket`→`Validate`, vendor POS, event wallet band), `internal/loyalty/black.go` (perk redemption); wired in `internal/app/top5_p2_routes.go`, `top5_p3_routes.go`.
**Slug:** `CREDENTIAL` (uppercase, used in Case IDs)

## 1. Overview & scope

Credential is a **shared internal primitive** that mints and validates rotating, signed QR /
NFC tokens for physical gate entry — event tickets, cashless wallet bands, vendor POS-lite
identity, loyalty perks, steward passes. It has **no HTTP surface of its own**: it is called
in-process by `top5events` and `loyalty`, which expose the auth-gated endpoints (e.g.
`top5events.ScanTicket` → `credential.Validate`). **All cases in this file are therefore
framed at the service-function level** (`Service.Issue/CurrentToken/Validate/Revoke/Reconcile`),
exercised through a live `pgxpool` and, for end-to-end auth/flag behavior, through the caller.

The security core is **single-use + anti-replay + anti-screenshot**: the on-wire `Token` is
short-lived (pinned to a `RotateTTL` window bucket) and HMAC-SHA256-signed
(`sign(secret, cid|window|nonce)`); the persisted `Credential` row is the authority the token
references. Replay is defeated by a **guarded conditional UPDATE**
(`state='USED' WHERE id=$1 AND state='ACTIVE'`) — exactly one scanner wins the row, all others
see 0 rows affected and are rejected `replay_rejected`. A screenshot taken in an earlier window
lands in a stale bucket and is rejected `stale_window` even with a valid signature.

No money moves here (money-invariants do **not** apply). Auth/RBAC are enforced by the calling
module's routes, not this package — see `../cross-cutting/authentication.md` and
`../cross-cutting/rbac-and-permissions.md`; flag-off behavior is the caller's
(`../cross-cutting/feature-flags-and-audit.md`). Every accepted/rejected scan is appended to
`credential_validations` (audit trail) and, when an `Auditor` is wired, `Issue`/`Validate`/
`Revoke` emit an audit action (nil auditor is safe).

## 2. Services / endpoints in scope

No routes. Public service functions (all take `context.Context`):

| Operation | Service func | Auth / permission | Money-path? |
|---|---|---|---|
| Mint a credential | `Issue(subjectRef, kind, policy) (*Credential, error)` | caller-enforced (e.g. `arena.admin`/organiser) | no |
| Current rotating token | `CurrentToken(credentialID) (*Token, error)` | caller (owner) | no |
| Validate a presented token at a gate | `Validate(tok Token, gate Gate) (*Result, error)` | caller (steward pass) | no |
| Queue an offline scan | `EnqueueOffline(tok, gate) error` | caller | no |
| Drain + resolve offline scans | `Reconcile(limit int) (int, error)` | caller (job) | no |
| Revoke an active credential | `Revoke(credentialID) error` | caller (organiser/admin) | no |

Behavioral notes to assert:
- `Issue` requires a non-empty `subjectRef` (else error); defaults `RotateTTL` to 30s and
  `ValidFrom` to now when zero; mints a fresh HMAC secret + NFC token; row starts `ACTIVE`.
- `CurrentToken` errors when the credential is **not `ACTIVE`** (revoked/used/expired).
- `Validate` never hard-fails on a bad token — it returns a `Result{OK:false, Reason:...}`
  (error is reserved for a DB fault on `consume`). Reason strings are stable
  (`not_found`, `revoked`, `expired`, `not_yet_valid`, `bad_signature`, `stale_window`,
  `replay_rejected`).
- Guard order inside `Validate`: state (revoked/expired/used) → time window
  (`valid_from`/`valid_to`, and `valid_to` past ⇒ auto-`expire`) → signature → stale-window
  (must equal current bucket or `current-1` for clock skew) → re-entry dedupe (if
  `AllowReentry`) → single-use consume.
- `Revoke` is a guarded `state='REVOKED' WHERE state='ACTIVE'`; revoking a missing/terminal
  credential returns an error (0 rows affected).

## 3. Test matrix by layer

There are **no `*_test.go` files in `internal/credential/`** — the package is currently
covered only indirectly through the caller's integration suite.

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Issue → ticket credential minted (via checkout) | int | `internal/top5events/service_integration_test.go` (imports `internal/credential`; gated on `TEST_DATABASE_URL`) | PARTIAL |
| Single-use consume / replay reject | inv | — (guarded-UPDATE logic uncovered by a direct test) | TODO |
| Token signature verify / forgery reject | unit | — | TODO |
| Stale-window (anti-screenshot) reject | unit | — | TODO |
| Re-entry dedupe within window | int | — | TODO |
| Revoke lifecycle + non-revocable error | int | — | TODO |
| Offline enqueue → reconcile (accept / duplicate→reject) | int | — | TODO |
| Expiry auto-transition on `valid_to` past | int | — | TODO |
| Concurrent same-window scan → exactly one accept | inv | — | TODO |
| Audit append per scan | int | — (shared `../cross-cutting/feature-flags-and-audit.md`) | PARTIAL |

## 4. Manual test cases

Preconditions common to happy-path cases: a reachable `pgxpool` with the `credentials` +
`credential_validations` tables; a `Service` built via `NewService(db, audit)`.

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `CREDENTIAL-INT-001` | Issue → CurrentToken → Validate accepts | P0 | fresh single-use credential | `Issue`, `CurrentToken`, `Validate` in same window | `Kind=event_ticket`, `Policy{SingleUse:true}` | `Result.OK=true`; row flips `ACTIVE`→`USED`; one `ACCEPTED` validation row |
| `CREDENTIAL-INV-001` | Second scan of single-use rejected (replay) | P0 | credential already `USED` (CREDENTIAL-INT-001 done) | `Validate` again, any valid token | fresh `CurrentToken` | `OK=false, Reason=replay_rejected`; state stays `USED`; `REJECTED` row appended |
| `CREDENTIAL-INV-002` | Concurrent same credential → exactly one accept | P0 | fresh single-use credential | Fire N=10 concurrent `Validate` on valid tokens | same credential | Exactly one `OK=true`; nine `replay_rejected` (guarded `UPDATE ... WHERE state='ACTIVE'` wins once) |
| `CREDENTIAL-CON-001` | Issue rejects empty subjectRef | P1 | — | `Issue("", ...)` | empty subject | error `subjectRef required`; no row inserted |
| `CREDENTIAL-SEC-001` | Tampered signature rejected (forgery) | P0 | active credential | `Validate` with a token whose `Sig` is altered | flip one hex char of `Sig` | `OK=false, Reason=bad_signature`; not consumed |
| `CREDENTIAL-SEC-002` | Token forged with wrong secret rejected | P0 | active credential | Mint a `Token` signing with a different secret, `Validate` | wrong-secret sig | `OK=false, Reason=bad_signature` (HMAC mismatch) |
| `CREDENTIAL-SEC-003` | Stale-window screenshot rejected | P0 | active credential, `RotateTTL=30s` | Capture token in window W, advance ≥2 windows, `Validate` | `tok.Window = cur-2` | `OK=false, Reason=stale_window` even though signature is valid |
| `CREDENTIAL-FSM-001` | Prev-window token tolerated (clock skew) | P2 | active credential | `Validate` with `tok.Window = cur-1` | one window back | Accepted (skew tolerance is `cur` or `cur-1`) |
| `CREDENTIAL-INT-002` | Not-yet-valid credential rejected | P1 | `Policy.ValidFrom` in the future | `Validate` now | future `valid_from` | `OK=false, Reason=not_yet_valid`; state unchanged |
| `CREDENTIAL-INT-003` | Expired-by-time auto-expires + rejects | P1 | `Policy.ValidTo` in the past | `Validate` now | past `valid_to` | `OK=false, Reason=expired`; row transitioned `ACTIVE`→`EXPIRED` |
| `CREDENTIAL-INT-004` | Re-entry dedupe accepts as re-entry | P1 | `Policy{AllowReentry:true, ReentryWindow:1h}`; one prior accept at gate G | `Validate` again at gate G within window | same gate | `OK=true, Reentry=true`; recorded `ACCEPTED "reentry"`, not a fresh consume |
| `CREDENTIAL-INT-005` | Revoke then validate rejected | P0 | active credential | `Revoke`, then `Validate` | valid token | `Revoke` ok; `Validate` → `OK=false, Reason=revoked` |
| `CREDENTIAL-CON-002` | Revoke missing/terminal credential errors | P2 | credential already `USED`/absent | `Revoke(id)` | terminal id | error `not revocable`; no state change |
| `CREDENTIAL-INT-006` | Unknown credential id → not_found | P2 | random id | `Validate` with token for unknown id | non-existent `cid` | `OK=false, Reason=not_found`; `REJECTED` row appended |
| `CREDENTIAL-INT-007` | Offline enqueue → reconcile accepts once | P1 | fresh single-use credential | `EnqueueOffline`, then `Reconcile(100)` | PENDING scan | Pending row resolves to `ACCEPTED`; credential consumed once |
| `CREDENTIAL-INV-003` | Reconcile duplicate offline scan → reject | P1 | credential already consumed; a PENDING dup exists | `Reconcile(100)` | duplicate PENDING | Dup resolves to `REJECTED`/`replay_rejected`; count returned |
| `CREDENTIAL-SEC-004` | Caller flag off → no credential-backed endpoint | P0 | `FEATURE_EVENTS_ENABLED=false` | Call the caller's scan route (e.g. `top5events` scan) | valid token | 404 — caller routes not mounted; the primitive is unreachable (see `FLAG-SEC-001`; flag has no own gate) |

## 5. State-machine transitions

`State` (`model.go`): `ACTIVE → USED` (single-use consume), `ACTIVE → REVOKED` (`Revoke`),
`ACTIVE → EXPIRED` (`expire`, on `valid_to` past during `Validate`). `USED`/`REVOKED`/`EXPIRED`
are **terminal**.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| ACTIVE | `Validate` accepts single-use | USED | `used_at` set; `ACCEPTED` row | `CREDENTIAL-INT-001` |
| ACTIVE | `Revoke` | REVOKED | `credential.revoke` audit | `CREDENTIAL-INT-005` |
| ACTIVE | `Validate` with `valid_to` past | EXPIRED | `expire`; `REJECTED expired` | `CREDENTIAL-INT-003` |
| ACTIVE | concurrent `Validate` (loser) | ACTIVE→(one wins)USED | 0 rows for losers → `replay_rejected` | `CREDENTIAL-INV-002` |

**Illegal / idempotent transitions to assert are rejected:**
- `USED`/`REVOKED`/`EXPIRED` + `Validate` → no transition; `replay_rejected` (used) /
  `revoked` / `expired` respectively (`CREDENTIAL-INV-001`, `-INT-005`).
- `Revoke` on a terminal credential → error, no state change (`CREDENTIAL-CON-002`);
  re-revoking is not silently idempotent (0 rows affected ⇒ error) — assert this explicitly.
- `CurrentToken` on any non-`ACTIVE` state → error (no token minted).

## 6. Security & abuse cases

- **Replay / double-scan** — CREDENTIAL-INV-001/002/003; the guarded conditional UPDATE is the
  single-use raison d'être. Concurrency must resolve to exactly one accept.
- **Forgery** — CREDENTIAL-SEC-001/002; HMAC-SHA256 over `cid|window|nonce` with the
  per-credential secret (never serialised out — `Secret` has `json:"-"`). Any tamper →
  `bad_signature`.
- **Anti-screenshot / stale window** — CREDENTIAL-SEC-003; a captured QR is only valid for its
  rotation bucket (and one prior for skew). Assert an old-window token is rejected even with a
  valid signature.
- **Lifecycle bypass** — CREDENTIAL-INT-002/003/005; not-yet-valid, expired, and revoked
  credentials cannot pass a gate.
- **Auth / RBAC** — enforced by the calling module's routes, not this package. Issue/Revoke
  are organiser/admin actions and Validate is a steward action at the caller; assert the
  caller gates them (`../cross-cutting/rbac-and-permissions.md`) — this file does not
  re-derive those.
- **Fail-closed on flag off** — CREDENTIAL-SEC-004; the primitive has no own flag, so
  reachability is entirely the caller's `FEATURE_EVENTS_ENABLED`/`FEATURE_LOYALTY_ENABLED`.
- **Audit** — every accept/reject appends a `credential_validations` row; wired `Auditor`
  emits `credential.issue/validate/revoke` (`AUDIT-INT-00x`). Note `Revoke` logs an **empty
  actor** subject (`s.log("", ...)`) — flag in report as a traceability gap (the revoking
  admin's id is not captured).

## 7. Automated specs to add

- `internal/credential/token_test.go` — pure-crypto table (no DB): `sign`/`verifyToken`
  round-trip, tamper → mismatch, wrong-secret → mismatch, `windowFor`/`mintToken`
  determinism per window and boundary at bucket flip. Table-driven Go.
- `internal/credential/validate_test.go` — DB-backed (gated on `TEST_DATABASE_URL`) table over
  every `Validate` branch: happy accept, replay, revoked, expired (+ auto-expire),
  not-yet-valid, bad-signature, stale-window, prev-window skew tolerance, re-entry dedupe.
  Assert the appended `credential_validations` outcome/reason each time.
- `internal/credential/concurrency_test.go` — N-goroutine `Validate` on one single-use
  credential asserting exactly one `OK=true` and `state='USED'` once (mirrors ledger TOCTOU
  tests).
- `internal/credential/reconcile_test.go` — `EnqueueOffline` × k then `Reconcile`: first wins
  `ACCEPTED`, duplicates `REJECTED replay_rejected`; assert returned count and `limit` clamp
  (≤0 or >500 ⇒ 100).

## 8. Coverage target & exit criteria

Tier-2 primitive, but security-critical: aim ≥ 85% on the pure token crypto (`sign`,
`verifyToken`, `windowFor`, `mintToken`) and ≥ 75% on `Validate`/`consume`/`Revoke` branch
logic. **Exit criteria (must be green before release):** CREDENTIAL-INT-001,
CREDENTIAL-INV-001, CREDENTIAL-INV-002 (exactly-once under concurrency), CREDENTIAL-SEC-001,
CREDENTIAL-SEC-003 (anti-screenshot), CREDENTIAL-INT-005 (revoke blocks entry), and
CREDENTIAL-SEC-004 (caller flag off → unreachable). Any red among these is a do-not-ship blocker.
</content>
