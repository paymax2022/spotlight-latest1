# Surface: Web App API Routes (`frontend-web/`)

**Stack:** Next.js 14 App Router. **Risk tier: mixed (0 for auth/webhooks/wallet).**
These route handlers under `frontend-web/app/api/**` are the boundary the mobile app and web UI
call. Auth is a Bearer token validated by a service-role Supabase client
(`frontend-web/src/lib/auth/request.ts`); a session cookie is enforced in
`frontend-web/src/middleware.ts`. Existing tests: `frontend-web/tests/unit/**` (golden-path,
money-invariants, wallet, tiers, kyc, voting, utility, registration, estate).

Cross-cutting cases (`../cross-cutting/authentication.md`, `money-invariants.md`,
`webhooks-and-providers.md`) apply here too — run them against these routes.

## 1. Route groups in scope

| Group | Paths | Tier | Notes |
|---|---|---|---|
| Auth | `app/api/auth/*` (login, register, logout, me, forgot/reset-password, verify/resend-otp) | 0 | Supabase-backed (`_supabase.ts`) |
| Paystack webhook | `app/api/webhooks/paystack/route.ts` + `gateway-handler.ts` (votes) + `utility-handler.ts` (bills) | 0 | HMAC-SHA512; two sub-handlers |
| KYC webhooks | `app/api/kyc/webhooks/[provider]/` | 0 | provider signature |
| Wallet & payments | `app/api/v1/wallet/*` (balance, transactions, topup + `topup/[reference]`), `v1/virtual-accounts/me`, `v1/banks(+resolve)`, `v1/beneficiaries`, `v1/transfers/*`, `v1/disputes` | 0 | |
| Bills / Utility | legacy `app/api/bills/*`; new `app/api/v1/utility/*` (billers/categories/products/validate/pay/beneficiaries/transactions + paystack initiate/verify/callback) | 0 | double-charge risk |
| Contests / Voting | `app/api/votes/*`, `app/api/v2/votes/*`, `app/api/open-mic/votes/*` | 0/2 | **3 coexisting engines — regression-prone** |
| Contest apply | `open-mic`, `stem`, `registration`, `academy` apply/pay flows | 1 | |
| Super-app proxies | `app/api/v1/<domain>/[...path]` (~40 domains) | varies | thin catch-all proxy to backend |
| Embedded admin | `app/api/admin/**` | 0/1 | see `admin-dashboard.md` |
| Me / misc | `app/api/me/*`, `dashboard`, `contact`, `inquiries`, `finance/kyc` | 1/2 | |

## 2. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| WEB-AUTHZ-001 | Protected route requires Bearer | P0 | — | Call `GET /api/v1/wallet/balance` with no token | — | 401 |
| WEB-AUTHZ-002 | Token identity used, not body `user_id` | P0 | `qa-user-a` token | Call wallet with `user_id=<qa-user-b>` in body/query | spoofed id | Returns A's data only |
| WEB-AUTHZ-003 | Cookie/session middleware redirect | P1 | web UI | Hit a protected page without session | — | Redirect to login (`middleware.ts`) |
| WEB-WH-001 | Paystack webhook valid HMAC → credit | P0 | pending topup ref | POST `charge.success` signed with `PAYSTACK_WEBHOOK_SECRET` | matching ref | Wallet credited once (see `../cross-cutting/webhooks-and-providers.md`) |
| WEB-WH-002 | Forged HMAC rejected | P0 | — | POST with wrong signature | tampered | Rejected; no credit |
| WEB-WH-003 | Gateway vs utility routing | P1 | — | POST a vote payment and a bill payment | both | Routed to correct sub-handler; no cross-effect |
| WEB-WH-004 | Webhook replay idempotent | P0 | applied event | POST identical event again | same id | No double-credit |
| WEB-CON-001 | Topup initiate → verify contract | P0 | `qa-user-a` | `POST v1/wallet/topup` then `GET topup/[reference]` | kobo amount | Shapes match openapi; amounts kobo-exact |
| WEB-INT-001 | Utility pay: insufficient balance | P0 | wallet < price | `POST v1/utility/pay` | over-balance | Blocked; no debit |
| WEB-INT-002 | Utility pay: double-submit → one charge | P0 | funded wallet | Submit same pay twice (same Idempotency-Key) | same key | Exactly one debit + one provider call |
| WEB-INT-003 | Bank transfer resolve + initiate | P0 | funded, beneficiary | resolve account → `POST v1/transfers/bank` | valid NUBAN (sandbox) | Resolves; transfer created; KYC/tier gate applied |
| WEB-VOTE-001 | Paid vote via wallet debits once | P0 | funded | `POST` paid vote (wallet) | same key on retry | Single debit (golden-path `paid-vote.spec.ts`) |
| WEB-VOTE-002 | Free vote rate/limit | P1 | — | Submit free votes past limit | — | Limit enforced (note gap G8: kobo-exact drift in free-vote spec) |
| WEB-PROXY-001 | Proxy forwards auth + path | P1 | `qa-user-a` | Call a `v1/<domain>/[...path]` proxy | — | Forwards Bearer; path/query preserved; backend response passed through |
| WEB-PROXY-002 | Proxy flag-off domain | P1 | domain flag off | Call the proxy | — | Not-found/forbidden, not 500 |
| WEB-SEC-001 | No secrets to client | P0 | — | Inspect responses / bundle | — | No service-role key / provider secret leaked (`check-client-secrets.sh`) |

## 3. Automated specs to add

- Extend golden-path suite with the three voting engines side-by-side to catch cross-engine
  regressions.
- Add `tests/unit/webhooks/paystack-routing.spec.ts` (gateway vs utility + replay).
- Add proxy contract tests for the highest-traffic `v1/<domain>` routes.
- Fix gap G1 (add `test:regression` script) and gap G2 (extend `contract:check`).

## 4. Exit criteria

Auth + webhook + wallet/utility P0 cases green; double-charge prevention proven on utility and
paid-vote; no client-secret leakage; three voting engines regression-checked.
