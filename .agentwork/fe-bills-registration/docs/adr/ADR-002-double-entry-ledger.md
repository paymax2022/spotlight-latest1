# ADR-002 — Double-Entry Ledger and Wallet Balance Model

**Status:** Accepted  
**Date:** 2026-06-13  
**Deciders:** Prince Chuks (lead)

---

## Context

Spotlight is adding a wallet with top-up, spend, and refund flows. We need to choose how to store and query wallet balances without introducing float rounding errors, silent double-credits, or a mutable balance column that can drift from reality.

Three options were considered:

| Option | Description | Risk |
|---|---|---|
| A | Store `balance` column on `user_profiles`, UPDATE on every transaction | Balance can diverge from transaction history. No audit trail per entry. Race conditions under concurrent writes. |
| B | Single `wallet_transactions` table; balance = SUM | No credit/debit polarity enforcement. Reversal logic is ad-hoc. |
| C | Double-entry ledger (`ledger_accounts` + `ledger_entries`); balance = view projection | More tables, but correct by construction. Industry standard for financial systems. |

---

## Decision

**Option C — double-entry ledger with a SQL view projection.**

### Schema

```
ledger_accounts (id, user_id → auth.users, type='wallet', currency='NGN')
ledger_entries  (id, account_id → ledger_accounts, type, amount_kobo BIGINT, reference, idempotency_key UNIQUE, created_at)
wallet_balance  VIEW: SUM projection of ledger_entries
```

### Entry types

| Type | Effect on balance | Use case |
|---|---|---|
| CREDIT | +amount | Top-up confirmed, reward |
| DEBIT | -amount | Spend, vote purchase |
| REVERSAL_CREDIT | -amount | Reverse a CREDIT (refund cancelled top-up) |
| REVERSAL_DEBIT | +amount | Reverse a DEBIT (refund a spend) |

Balance formula (SQL and TypeScript are identical):

```sql
SUM(CASE
  WHEN type IN ('CREDIT', 'REVERSAL_DEBIT') THEN  amount_kobo
  WHEN type IN ('DEBIT', 'REVERSAL_CREDIT') THEN -amount_kobo
END)
```

### Key invariants

1. **`amount_kobo` is BIGINT** — no NUMERIC, no FLOAT. Kobo (minor unit). All math is integer arithmetic.
2. **`amount_kobo > 0` always** — direction is encoded in `type`, not sign.
3. **`idempotency_key` is UNIQUE** — prevents double-credit on webhook retry.
4. **Entries are immutable** — no UPDATE/DELETE RLS policy for `authenticated`. Only `service_role` writes. Corrections are new reversing entries.
5. **Balance is never stored** — `wallet_balance` is a VIEW. No column on `user_profiles` or elsewhere.

---

## Consequences

**Good:**
- Balance cannot silently drift: it's always a deterministic projection of immutable history.
- Full audit trail without a separate log table.
- Idempotency built into the schema — retry-safe by construction.
- Reversals are first-class operations, not soft-deletes.
- CBN compliance: every naira movement is traceable to a reference.

**Bad / trade-offs:**
- Two tables instead of one — JOIN required for balance lookup.
- `wallet_balance` view is a full aggregation scan on large accounts; add a materialized view or caching layer if p95 latency degrades.
- Slightly more complex service code vs. simple balance UPDATE.

---

## Alternatives rejected

- **Mutable balance column**: rejected because it cannot be made consistent with the transaction history without application-level locking, and it provides no audit trail.
- **Signed amounts (positive/negative in one column)**: rejected because it conflates amount magnitude and transaction direction; range CHECK constraints become awkward; reversal tracking is harder.
