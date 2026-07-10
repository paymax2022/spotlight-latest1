# Round 2 — Money/Compliance P0 Re-Verification (static)

Verification pass over the just-applied P0 fixes. Static code read only; **no code changed**.
Module: `spotlight/backend`. Date: 2026-07-10.

---

## VERIFY 1 — Crypto withdrawal AML gate

**Invariant:** *No crypto money leaves before AML approval.*
**Verdict: PASS.**

| # | Item | Expected | Verified? | Evidence (file:line) | Residual |
|---|------|----------|-----------|----------------------|----------|
| 1a | Member `Withdraw` parks + returns; no provider Broadcast on member path | `requested → pending_review`, then `return`; zero `Broadcast` calls reachable from member flow | **PASS** | `service_ext.go:422-434` (transition to `pending_review`, audit, `return out`); grep for `s.withdraw.Broadcast(` yields exactly ONE hit, `service_ext.go:457`, inside `broadcastApprovedWithdrawal` — not on member path | none |
| 1b | Broadcast fires ONLY from admin approve path | `broadcastApprovedWithdrawal` reached via `pending_review → approved` in `AdminDecideWithdrawal` | **PASS** | `admin_service.go:95-100` calls `broadcastApprovedWithdrawal` only when `decision=="approve"` after `pending_review → approved`; `service_ext.go:450-457` is the sole `Broadcast` caller | none |
| 1c | `AdminListWithdrawals` surfaces `pending_review` (queue reachable) | default status = `pending_review` when none supplied | **PASS** | `admin_service.go:32-36` defaults `status = WithdrawalPendingReview` (`= "pending_review"`, `model_ext.go:102`) | none |
| 1d | reject `pending_review → failed` returns parked units; guarded + idempotent + audited | guarded `WHERE status=$from`, returns `cur.Units`, audit emitted | **PASS** | `admin_service.go:62-90` — reads row, guards `cur.Status != WithdrawalPendingReview → ErrInvalidTransition` (idempotent: 2nd decision rejected), sets `returnUnits = cur.Units`, calls guarded `AdminTransitionWithdrawal(... PendingReview, Failed ...)`, then `audit.log` (fatal on err). FSM `model_ext.go:116` allows `pending_review → failed` | none |
| 1e | Migration widens status CHECK (adds `pending_review` + `approved`, narrows nothing) | additive CHECK replace; legacy values retained | **PASS** | `20260920000000_crypto_schema.sql:78-89` new CHECK = `{requested, pending_review, approved, pending(legacy), broadcast, confirmed, failed}`; original (`20260901001200:99-100`) = `{requested, pending, broadcast, confirmed, failed}` — every legacy value kept, two added. Guarded by `to_regclass`, idempotent add. No later crypto migration narrows it (20260920000000 is the newest touching `crypto_withdrawals`) | none |
| 1f | Admin FRONTEND keys queue off `pending_review` (not `requested`) | default filter + decidability gated on `pending_review` | **PASS** | `frontend-admin/.../withdrawals/page.tsx:25` `useState('pending_review')`; `:62` `pending = rows.filter(w => w.status === 'pending_review')`; `:153` `decidable = w.status === 'pending_review'` | Cosmetic only: stale copy in `subtitle`/`DisclosureNote` (`:68`, `:76`) still says `requested → pending → …`. Display text, not behavior. |

**Supporting FSM confirmation** (`model_ext.go:114-121`): `requested → {pending_review, failed}`, `pending_review → {approved, failed}`, `approved → {broadcast, failed}`, `broadcast → {confirmed, failed}`, `confirmed`/`failed` terminal. The AML gate (`pending_review`) sits strictly before any `broadcast`. No transition reaches `broadcast` without first passing `approved`, which is only reachable from `pending_review` via the admin path.

**Conclusion:** The member path cannot broadcast. Broadcast is dispatched exclusively from the admin approve path after `pending_review → approved`. Invariant holds.

---

## VERIFY 2 — FX Convert

**Invariant:** *FX convert cannot double-credit and always double-enters.*
**Verdict: PASS.**

| # | Item | Expected | Verified? | Evidence (file:line) | Residual |
|---|------|----------|-----------|----------------------|----------|
| 2a | No bare `UPDATE currency_wallets SET balance_minor` without ledger counterpart | balance moved only as a ledger mirror | **PASS** | Only balance write in package: `service.go:311-318` `mirrorCurrencyWalletTx`, called solely at `service.go:242` inside the conversion tx (grep confirms one call site). It runs after the target-leg `PostJournal` (`service.go:175-183`) and inside the same tx as the conversion insert | see note below (NGN standing accounts) |
| 2b | Target leg = balanced `PostJournal`; source leg = `Debit`; per-leg idem keys from single request key | DR settlement → CR fx-spread for target; user Debit for source | **PASS** | Source leg `service.go:146` `Debit(... req.IdempotencyKey+":debit" ...)`; target leg `service.go:175-181` `PostJournal{ IdempotencyKey: req.IdempotencyKey+":credit", DR settlementAcc, CR fxSpreadAcc }` | none |
| 2c | Conversion insert idempotent (`ON CONFLICT (idempotency_key) DO NOTHING RETURNING`); replay is no-op returning existing | race-loser skips wallet mirror | **PASS** | `service.go:215-234` `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`; on `pgx.ErrNoRows` rolls back and returns `getConversionByKey` (`:228-234`) — mirror NOT re-applied. Durable UNIQUE guard confirmed in schema: `20260920000300_fx_convert_idempotency.sql` + original `NOT NULL UNIQUE`. Fast pre-check `:121-126` is optimization only (no TOCTOU reliance) | none |
| 2d | debit→convert→credit→record atomic, fail-closed on provider error | one pgx tx for record+mirror; provider failure reverses debit | **PASS** | Provider failure `service.go:158-163` posts `postReversal` (fail-closed, user net-zero, nothing credited/recorded). Record + wallet mirror commit together `service.go:209-248` (`Begin` … `mirrorCurrencyWalletTx` … `Commit`), gated by the unique key | see note below |

**Note (known residual, NOT a new break):** The target-currency (foreign) leg is recorded on **NGN-denominated standing accounts** (`AccountSettlement` DR, `AccountFXSpreadIncome` CR) with `AmountKobo = convResp.TargetAmountMinor`. So a non-NGN minor-unit amount is booked into kobo-labelled standing accounts — the ledger double-enters and balances, but the foreign leg is not in a currency-segregated account. This is a **modeling limitation carried over**, not a regression introduced by the fix: prior to the fix the target leg had *no* ledger counterpart at all (bare balance write). The fix strictly improves the position (double-entry restored, idempotent, atomic). Recommend a follow-up (non-P0) to introduce per-currency standing accounts so the FX ledger is currency-correct.

---

## Re-scan for OTHER money mutations introduced by the fixes

Searched `backend/` for `SET balance` / `SET saved_minor` / `SET amount_paid` / `SET balance_minor` and missing-idempotency mutations.

| Location | Finding | New risk? |
|----------|---------|-----------|
| `finance/fx/service.go:316` | `mirrorCurrencyWalletTx` — the reviewed, tx-scoped, ledger-mirrored write (item 2a) | No — this IS the fix |
| `orchestration/repository.go:56,80,85,130` | `orch_balances` UPDATE/upsert of `balance_minor` | No — pre-existing `orchestration` module, outside the P0 fix scope; not introduced or altered by these fixes. Flagged for separate audit but not a Round-2 regression |
| `academy/fees/invoice/model.go:16` | Comment asserting NO `UPDATE ... SET balance/amount_paid` — invoice balances are ledger projections | No — projection pattern, no bare write |

No new bare-balance write and no missing-idempotency money mutation was introduced by the P0 fixes.

---

## Summary verdicts

- **VERIFY 1 (crypto AML gate):** **PASS** — 1a–1f all pass. Only residual is cosmetic stale copy in the admin page subtitle/disclosure text (behavior is correct).
- **VERIFY 2 (FX convert):** **PASS** — 2a–2d all pass. Known residual (NGN standing accounts for the foreign leg) confirmed as a carried-over modeling limit, not a new break.
- **Re-scan:** No new money-mutation defects introduced.

### Non-blocking follow-ups
1. Update stale copy in `frontend-admin/app/admin/crypto/withdrawals/page.tsx` (subtitle `:68`, DisclosureNote `:76`) from `requested → pending → …` to `pending_review → approved → broadcast → …`.
2. Introduce per-currency ledger standing accounts so the FX target leg is currency-correct (RISK-FX modeling residual).
3. `broadcastApprovedWithdrawal` runs the provider call inline on the admin approve HTTP request (TODO at `service_ext.go:448` to move to an asynq worker) — operational, not a correctness break.
