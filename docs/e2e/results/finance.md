# FINANCE module — production E2E validation results

Date: 2026-10-03. Stack exercised live: Next dev :3000 (BFF proxies → `GO_BACKEND_URL=http://localhost:8080`), admin console :3001, Go api :8080 (HEAD+fixes working tree), GoTrue via Kong :54321, Postgres `supabase_db_spotlight` :54322, Mailpit :54324.

Specs: `frontend-web/tests/e2e/finance/` — 7 specs / **18 tests, all green on `chromium-desktop`** (~3.5s, 5 workers). Every spec runs on its own `provisionVerifiedUser`-created accounts; psql is used ONLY for fixture setup (email-confirm, kyc_tier, recipient phone, the balanced `provider_clearing`→`user_wallet` funding journal the top-up webhook posts) and read-only assertions (ledger sums, attribution rows).

Environment facts verified before testing:
- Flags ON in backend/.env: `FEATURE_WALLET_ENABLED`, `FEATURE_SAVINGS_ENABLED`, `FEATURE_SOCIAL_PAY_ENABLED`, `FEATURE_LOYALTY_ENABLED`, `FEATURE_REFERRALS_ENABLED`, `FEATURE_REFERRAL_REWARDS_ENABLED`, `FEATURE_TIER_LIMITS_ENABLED`, `FEATURE_WALLET_TRANSFERS_ENABLED`, `FEATURE_BANK_TRANSFERS_ENABLED`, `FEATURE_CHECKOUT_TOPUP_TIER0`.
- `REFERRAL_REWARDS_INTERNAL_SECRET` is **unset** → `/internal/referrals/*` hooks fail closed (verified live: 503/401 both without and with wrong secret).
- `wallet_balance` is a VIEW over `ledger_entries`; balances are projections — never updated directly. SQL sum-of-entries == reported balance was asserted on every funded user.
- Tier model (internal/finance/tiers/service.go): Tier0 → `EnforceWalletDebitLimit` → 403 `wallet_disabled`; Tier1 → ₦50,000/day (5,000,000 kobo); Tier3 → unlimited. Fail-closed on tier-lookup error (GetUserTier wraps the DB error into the enforce path — the check can never pass silently; verified at code level, no outage injection in this run).

## Verdicts

| ID | Journey | Verdict |
|----|---------|---------|
| FIN-001 | wallet surface | **PASS** — `GET /api/finance/wallet/balance` (Go + BFF catch-all) returns funded kobo as integer; transaction list surfaces the funding journal; SQL sum-of-entries == balance; `/api/v1/wallet/balance` tier-1-gated, same pot. No wallet UI on web (gap F-N6). |
| FIN-002 | savings | **PASS** — FLEX vault create→deposit→balance→withdraw posts balanced legs each way (DR wallet/CR escrow, DR escrow/CR wallet); LOCK vault early-withdraw → 409; over-deposit → 400; Idempotency-Key enforced. |
| FIN-003 | tiers & limits | **PASS WITH P1 FINDING F-N1** — canonical rail fail-closed correct (Tier0→403, Tier1→201, over-cap→403) but the SAME Tier-0 wallet moved ₦1,000 to another user via social send and deposited to a vault — sibling rails bypass `EnforceWalletDebitLimit`. |
| FIN-004 | referrals | **PASS WITH P1 FINDING F-N2** — code-at-registration attribution works end-to-end (DB row + referrer list + my-attribution), but post-signup `/v1/referrals/attribute` is a silent no-op returning `200 {"referrer_id":""}`. Withdraw leg BLOCKED on KYC (403 verified as the gate, fail-closed). |
| FIN-005 | points/loyalty/cashtag | **PASS** — all member surfaces live; cashtag claim→resolve→send-by-tag posts balanced 4-leg journal and replays safely. Points accrual is contract-only (no member earn endpoint — internal trigger binding). Double-mount finding F-N3. |
| FIN-006 | idempotency under retry | **PASS** — transfer replay → `200 already_processed:true`, same reference, single journal; BFF forwards Idempotency-Key verbatim (replay through :3000 also replays); savings + social replays post no second leg. |
| FIN-007 | edge (auth/authZ) | **PASS** — anon → 401 on all 24 probed endpoints; user B → 403 on A's vault read/deposit/withdraw and admin wallet lookup; self-scope on wallet read verified; non-integer/non-kobo amounts → 400 before money moves. |

## Findings

- **F-N1 — P1 (defect): Tier-0 wallet-disabled is bypassable on sibling money rails.**
  `POST /api/finance/social/social/send` (cashtag P2P) and `POST /api/finance/savings/vaults/:id/deposit` call `ledger.Service.Debit` directly — the raw ledger mutation — instead of `wallet.Service.Debit`, which is the only wrapper carrying `tiers.EnforceWalletDebitLimit`. Verified live: a `kyc_tier=0` user (`fin003c-*@paymax.test`) was refused `POST /api/finance/transfers/paymax` with `403 wallet_disabled` and, in the same session, (a) sent ₦1,000 (100,000 kobo) to another user via `/api/finance/social/social/send` — a genuine cash-out-equivalent, value left the sender to a spendable recipient wallet — and (b) deposited ₦1,000 into a savings vault (wallet→escrow, internal-only). The social AML velocity check (`MaxSingleKobo ₦200,000`/`₦500,000` per day) is NOT a KYC substitute: it caps velocity, not eligibility.
  Evidence: `backend/internal/social/service.go:67` (`s.led.Debit`), `:142`, `:343`, `:444` (pay-request, split-share, pool-contribute same pattern); `backend/internal/savings/vault_service.go:234`; contrast `backend/internal/finance/wallet/service.go:60` (tier gate) and `backend/internal/finance/transfers/service.go:240` (`enforceTier: s.tiers.EnforceWalletDebitLimit`). Iron rule: "pass tier-limit checks fail-closed" — these rails check nothing.

- **F-N2 — P1 (defect): `POST /v1/referrals/attribute` is a silent no-op for every codeless signup.**
  Registration always writes a `referral_attributions` row (house default: `attribution_type=global_house`, `is_house=t`, `referrer_id NULL`) even when no code is entered. The attribute endpoint then: reads existing referrer → `""` → `INSERT … ON CONFLICT (referred_user_id) DO NOTHING` → no-op → re-reads the same house row → returns **`200 {"referrer_id":"","referred_user_id":<id>}`** — a success-shaped empty answer while nothing was attributed. The late-claim path is dead for 100% of users who registered without a code (i.e., almost everyone). The code-at-signup path (`referralCode` on `/api/auth/register` → §7A `ResolveReferrer`) DOES work — verified: `attribution_type=code`, real referrer_id, `is_house=f`, status `grace`.
  Evidence: `backend/internal/finance/referrals/rewards_service.go:361-396` (Attribute), DB rows inspected live. Also affects `/api/finance/referral/claim-code` if it shares the same conflict shape (not separately exercised).

- **F-N3 — P2 (defect): social-pay member routes are double-mounted.**
  Mounted at `/api/finance/social/social/*`, not `/api/finance/social/*`. The documented contract path 404s for authenticated callers AND anon. `finance_routes.go:608-609` passes `finance.Group("/social")` while `social.Handler.Register` adds `"/social"` itself — the exact latent bug the adjacent savings comment (line 583-584) warns about. Inventory CSV confirms: `internal/social/handler.go,POST,/api/finance/social/social/send`. Clients written against the documented path cannot reach the module at all.

- **F-N4 — P3 (ambiguity): two parallel referral code systems mint different codes per user.**
  `GET /api/finance/referrals/me` → `{"code":"FUNTJ",…}` (legacy `referral_codes`) while `POST /v1/referrals/link` → `{"code":"T63CT",…}` (engine `referral_links`) — for the SAME user. Both endpoints are live and both return "your code." Resolution at signup checks `referral_links` first then the legacy table (REF-002), so either code attributes — but the user-facing surface shows two different codes with no canonical one.

- **F-N5 — P3 (note): `balance_naira` float rides in the wallet balance payload.**
  `GET /api/finance/wallet/balance` returns `{balance_kobo: <int>, balance_naira: <float>}` — documented as a display convenience (`service.go:214`, "clients should format from balance_kobo"). Integer `balance_kobo` is authoritative; no float math was observed in any `*_kobo` field across all payloads (asserted). Recorded for completeness against the "no float math" iron rule.

- **F-N6 — P3 (gap): no finance UI exists on web.** No `app/**/page.tsx` wallet, savings, referral, loyalty, or points screen — every FIN journey was exercised at the real API surface (Go :8080 direct + the BFF proxies the mobile app consumes). Same shape as F-P1 (provider): the web product is consumer-facing only for these modules.

- **Note (fail-closed, good):** `POST /api/finance/referral/withdraw` → `403 "referral/ledger: verified KYC required to withdraw"` for a Tier-0 caller — the payout gate refuses before any money discussion.
- **Note (semantics):** savings-deposit replay under the same Idempotency-Key returns `200 {success:true, balance_kobo:<unchanged>}` (tolerated identical replay via ON CONFLICT + verifyReplayAmount) — safe, but unlike transfers' explicit `already_processed:true`, callers cannot distinguish a replay from a fresh deposit. Transfers: `201` fresh / `200` + `already_processed:true` replay. Social send: `200` + the same recorded `payment.id`.
- **Note (by design):** every codeless signup lands `global_house` attribution (§7A default-referrer) — referral_config `fallback_chain` ends at `global_house`; config read verified (`attribution_window_hours=72`, `house_account_code=SPOT-HOUSE`, `budget_neutral=true`).

## Journey details

### FIN-001 — wallet surface — PASS
Provisioned user funded ₦10,000 (1,000,000 kobo) via the balanced fixture journal.
`GET :8080/api/finance/wallet/balance` → 200 `{user_id, balance_kobo:1000000, balance_naira:10000}`;
same route through `:3000/api/finance/[...path]` → identical. `GET …/transactions` →
the funding `credit` leg (ref `e2e-*`, amount_kobo integer). SQL sum-of-entries ==
1,000,000 == reported. `GET :3000/api/v1/wallet/balance` (Next-side wallet service):
Tier-0 → **403** (`requireKycTier(1)`), Tier-1 → `200 {available_kobo:250000}` reading
the same `user_wallet` pot (ADR-045 unification confirmed: one pot, two readers).
Spec: `tests/e2e/finance/fin-001-wallet.spec.ts` (2 tests).

### FIN-002 — savings — PASS
BFF `POST :3000/api/v1/savings/vaults` {name,kind:FLEX,target_kobo} → **201**.
Deposit without Idempotency-Key → **400**; with key → **200** `balance_kobo` +
legs `savings:deposit:<vaultId>` = DR user_wallet 200,000 / CR escrow 200,000.
`GET …/vaults/:id/balance` → 200,000; `GET …/savings/summary` totals consistent;
wallet dropped 500,000→300,000. Withdraw 50,000 → DR escrow/CR wallet, wallet
350,000. Over-withdraw → **409**. LOCK vault: missing `matures_at` → 400; funded
LOCK vault early-withdraw → **409** (ErrLockedVault). Deposit > balance → **400**
(ErrInsufficientFunds → default 400 in savings errMap — the refusal is fail-closed
but the status isn't the 402 the transfer rail uses; cosmetic only).
Spec: `tests/e2e/finance/fin-002-savings.spec.ts` (3 tests).

### FIN-003 — tiers & limits — PASS (canonical) / P1 bypass found
Tier-0 sender (funded) `POST /api/finance/transfers/paymax` → **403**
`wallet_disabled`, balance unchanged. `setKycTier(1)` → same call **201**
`successful`, fee 0 (≤₦5,000 band), ledger journal DR sender/CR recipient.
`amount_kobo=5,100,000` (> ₦50k daily cap) → **403** `daily_limit_exceeded`.
Bypass probe (same Tier-0 wallet): social send → **200 success**, vault deposit →
**200 success** — recorded in test annotations + DB (`social_payments`,
`savings_vault_ledger` rows for `fin003c`). See F-N1.
Spec: `tests/e2e/finance/fin-003-tiers.spec.ts` (2 tests).

### FIN-004 — referrals — PASS (bounded)
`POST /v1/referrals/link` → 200 `{code:FTCAR…}` mints engine code. User B
`POST /api/auth/register {referralCode}` → `referral_attributions` row
`type=code, referrer=A, is_house=f, status=grace` (DB). A's
`GET /v1/referrals/me/referrals` lists B; B's `GET /api/finance/referral/my-attribution`
→ 200 with referrer/code/grace_expires_at. `GET …/referral/config` → 200;
`my-rewards`/`withdraw-eligible` → 0 kobo, integer types (no purchase event exists
to earn against). `POST …/referral/withdraw` → **403 verified-KYC-required** —
bounded leg BLOCKED: earning needs a purchase-settled event (internal hooks fail
closed, no secret; no emitting module purchase driven in scope) and withdrawal
needs real KYC (no local provider). `POST /v1/referrals/attribute` → **F-N2
silent no-op** (200, `referrer_id:""`, house row unchanged in DB). Self-referral →
400; unknown code → 400. `/internal/referrals/purchase-settled` → 503/401
fail-closed. Spec: `tests/e2e/finance/fin-004-referrals.spec.ts` (3 tests).

### FIN-005 — points / loyalty / cashtag — PASS
`GET /api/finance/loyalty/points/{balance,history,catalog}` → 200 (balance 0,
catalog ≥4 items, integer `*_kobo`/`cost_points`); `POST …/redeem` with 0 points →
refused (no negative). `GET …/loyalty/{me,tiers,rewards}` → 200. **No member earn
endpoint exists** — accrual is internal trigger-binding only (contract-only leg).
Cashtag: `POST /api/finance/social/social/handle` → 201; re-claim → 409; steal →
409. `GET …/handle/:h` resolves user_id. `POST …/social/send` ₦500 → 200; legs:
DR sender → CR escrow → DR escrow → CR recipient (escrow nets zero); replay →
same `payment.id`, single journal; unknown tag → 404.
Spec: `tests/e2e/finance/fin-005-points-cashtag.spec.ts` (2 tests).

### FIN-006 — idempotency under retry — PASS
Transfer: key K → **201** `{already_processed:false, ref:ww-…}`; replay (Go direct)
→ **200** `{already_processed:true}`, same reference; replay THROUGH :3000 BFF →
**200 already_processed** (proxy forwards `Idempotency-Key` verbatim — proven).
Ledger: exactly `K:debit` + `K:credit` rows (fee=0); balances correct after all
three calls. Savings deposit replay → **200** identical response, 2 ledger rows,
1 vault row — no double-post (F-N-note: response carries no replay marker).
Social send replay → **200** same `payment.id`, 4 ledger rows total (two
journals), no duplication. Spec: `tests/e2e/finance/fin-006-idempotency.spec.ts`
(3 tests).

### FIN-007 — edge — PASS
Anon → **401** on all 24 probed endpoints (14 GET + 10 POST across wallet,
savings, referral, loyalty, points, social, transfers, `/v1/referrals`).
User B vs A: vault balance/deposit/withdraw → **403** (object authZ in service);
`/api/finance/admin/wallets/:A/*` → **403** (RBAC `finance.admin.transfers`
fail-closed for non-admin). `/api/finance/wallet/balance` is self-scoped — no
parameter can read another user's pot (B sees only B's). `amount_kobo` of
`100.5`, `"100000"`, `-50000`, `0`, `null` → all **400** before money moves;
sender balance unchanged. Spec: `tests/e2e/finance/fin-007-edge.spec.ts` (3 tests).

## Coverage ledger — API paths exercised this run

- BFF (:3000): `POST /api/auth/register`, `/api/finance/[...path]` catch-all
  (balance + transfer replay), `/api/v1/savings/vaults*` (create/deposit/withdraw),
  `/api/v1/referral/{config,my-rewards,withdraw-eligible,withdraw}`,
  `/api/v1/wallet/balance`
- Go (:8080): `/api/finance/wallet/{balance,transactions}`,
  `/api/finance/savings/{vaults,summary,vaults/:id/{balance,deposit,withdraw}}`,
  `/api/finance/transfers/paymax`,
  `/api/finance/referral/{config,my-attribution,my-rewards,withdraw-eligible,withdraw}`,
  `/api/finance/referrals/me`,
  `/api/finance/loyalty/{me,tiers,rewards,points/{balance,history,catalog,redeem}}`,
  `/api/finance/social/social/{handle,handle/me,handle/:h,send}` (double-mounted, F-N3),
  `/api/finance/admin/wallets/:user_id/{balance,transactions}` (RBAC negative),
  `/v1/referrals/{link,attribute,me/referrals}`, `/internal/referrals/purchase-settled`
- psql: fixture-only writes (auth.users/platform_users confirm, kyc_tier, phone,
  funding journal) + read-only assertions (ledger_entries, savings_vault_ledger,
  social_payments, referral_attributions, wallet_balance).

## Ledger-integrity observations

- Every money mutation observed posted **balanced** double-entry journals:
  funding (DR provider_clearing / CR user_wallet), transfer (DR sender / CR
  recipient [+ fee leg when applicable]), savings deposit (DR wallet / CR
  escrow), withdraw (DR escrow / CR wallet), social send (wallet→escrow→wallet,
  transit nets zero).
- `sum(ledger_entries)` == reported `balance_kobo` on every funded account, at
  every step of the deposit→withdraw and send flows.
- Idempotency is enforced by unique `idempotency_key` per leg + derived per-leg
  suffixes (`:debit`/`:credit`, `:dr`/`:cr`, `:wallet`, `:vault`) — replay never
  produced a second row anywhere.
- All observed `*_kobo`/`amount_kobo`/`balance_kobo`/`eligible_kobo` payload
  fields are integers; floats refused at the transport (`ShouldBindJSON` int64).
- Corrections model holds: no UPDATE on balances observed; the vault sub-ledger
  (`savings_vault_ledger`) is append-only with its own idempotency constraint.

## Blockers / notes for next run

- Referral reward EARNING is unverified end-to-end: it requires a
  `purchase-settled` event (in-process emit from marketplace/bills or the
  internal HTTP hook). The hook fails closed with no `REFERRAL_REWARDS_INTERNAL_SECRET`
  configured; driving a real emitting purchase was out of scope. The withdraw path
  was exercised only to the KYC refusal — a positive-eligible withdraw needs a
  real KYC provider (none locally) AND an earned reward.
- Bank payout rails (`/api/finance/transfers/bank*`) untouched — needs Paystack
  disbursement rails; PIN flow (set/verify) not exercised for the same reason.
- `social_payments`/`savings` BOLA was probed on vault objects; deeper social
  surfaces (split-bill share payment, pool payout) were not individually
  traversed — they share the same service-layer owner checks.
- The `adminGroupTop5` auth-ordering gap noted in finance_routes.go:611-621 —
  `/api/savings/admin`, `/api/social/admin`, `/api/loyalty/admin`, etc. mount
  `requireUserID()` WITHOUT `RequireAuthContext`, so those admin groups may 401
  for every caller including super-admin (same bug fixed for events/trading/
  restaurant/insurance groups). Not exercised this run (member-surface scope);
  worth a dedicated probe in an admin wave.
