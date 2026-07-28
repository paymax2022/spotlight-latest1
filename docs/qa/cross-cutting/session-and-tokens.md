# Cross-cutting: Sessions, Service Tokens & Admin Keys

**Risk tier: 0.** Three non-user-JWT trust paths guard privileged and internal surfaces.
Sources: `backend/internal/services/session_service.go` (+ `session_supabase_repository.go`,
`handlers/session_handler.go`), `backend/internal/middleware/service_token.go`
(`RequireServiceToken`), `backend/internal/middleware/admin_auth.go` (`RequireAdmin`),
`backend/internal/app/internal_ledger_routes.go`.

## 1. Facts

- **Session revocation** (`SessionService.ValidateAccess`): when the enforcement flag is ON,
  `RequireAuthContextWithSessions` rejects a revoked/expired session **401 fail-closed**. Issue
  / validate / revoke lifecycle lives in `session_service.go`.
- **Service token** (`RequireServiceToken(expected)`): guards internal service-to-service
  endpoints (e.g. internal ledger API, `FEATURE_INTERNAL_LEDGER_API_ENABLED`). Bearer compared
  in **constant time**; **fail-closed 503 if `expected` (`LEDGER_SERVICE_TOKEN`) is unset** so a
  misconfigured deploy cannot expose the endpoint open.
- **Admin key** (`RequireAdmin(key)`): checks `x-admin-api-key` against `ADMIN_API_KEY`.
  **Dev-permissive when `ADMIN_API_KEY` is empty** — a config case must confirm prod sets it.

## 2. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| SESS-INT-001 | Issue → validate session | P0 | enforcement ON | Login, then call protected endpoint | valid token | 200; session validates |
| SESS-INT-002 | Revoke → subsequent request fails | P0 | active session | Revoke session, reuse token | — | 401 `session revoked` |
| SESS-INT-003 | Expired session rejected | P0 | session past expiry | Reuse token | — | 401 fail-closed |
| SESS-SEC-001 | Enforcement OFF = no-op | P1 | flag OFF | Reuse a token with no session row | — | 200 (preserves legacy behavior) |
| SVC-SEC-001 | Service token required | P0 | internal ledger API enabled, token set | Call internal endpoint with no/other bearer | wrong token | 401/403 rejected |
| SVC-SEC-002 | Correct service token accepted | P0 | token set | Call with correct `LEDGER_SERVICE_TOKEN` | correct token | 200 |
| SVC-SEC-003 | Unset token → fail-closed 503 | P0 | `LEDGER_SERVICE_TOKEN` empty | Call internal endpoint | — | **503** (never open) |
| SVC-SEC-004 | Constant-time compare | P2 | token set | Send tokens of varying prefix length | — | No timing oracle (behavioral: all rejected identically) |
| ADMIN-SEC-001 | Admin key required in prod config | P0 | `ADMIN_API_KEY` set | Call `RequireAdmin` endpoint with wrong/absent `x-admin-api-key` | wrong key | 401/403 |
| ADMIN-SEC-002 | Correct admin key accepted | P0 | key set | Correct `x-admin-api-key` | correct | 200 |
| ADMIN-SEC-003 | Dev-permissive only when unset | P0 | `ADMIN_API_KEY` empty (dev) | Call without header | — | Allowed in dev **only**; go-live checklist asserts key is set so this path is closed in prod |

## 3. Automated specs to add

- `backend/internal/middleware/service_token_test.go` — set/unset/correct/incorrect table incl.
  the unset→503 branch. (verify/extend)
- `backend/internal/middleware/admin_auth_test.go` — empty-key dev-permissive vs set-key
  enforcement. (gap)
- Extend `session_enforcement_test.go` with revoke + expiry integration cases.

## 4. Coverage target & exit criteria

Exit: service-token fail-closed (503 on unset) proven; admin-key enforced with a set key;
session revoke/expiry reject; go-live checklist confirms `ADMIN_API_KEY` and
`LEDGER_SERVICE_TOKEN` are set in staging/prod.
