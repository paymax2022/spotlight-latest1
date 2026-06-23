# ADR-003 — Dedicated Virtual Account Provisioning Model

**Status:** Accepted  
**Date:** 2026-06-13  
**Deciders:** Prince Chuks (lead)

---

## Context

Spotlight users need a persistent NGN bank account number they can use to receive money from any bank in Nigeria. Options considered:

| Option | Description | Risk |
|---|---|---|
| A | Paystack Dedicated Virtual Account (DVA) | Managed by Paystack; provisioning via API; inbound transfers via `charge.success` webhook |
| B | Flutterwave Dedicated Virtual Account | Alternative provider; same mechanism, different API |
| C | Build own NIP integration | Requires NIP license + CBN approval; out of scope for this phase |

---

## Decision

**Option A — Paystack DVA**, for consistency with the existing Paystack integration (topup flow, voting payments).

### Provisioning flow

```
User completes KYC → kyc_tier set to 1
Admin approval route calls provisionVirtualAccount(userId, email, firstName, lastName)
  → POST /customer (create Paystack customer)
  → POST /dedicated_account (provision DVA with preferred_bank)
  → INSERT virtual_accounts row
  → Return account_number, bank_name
```

Idempotency: `UNIQUE (user_id, provider, currency)` — second provision call returns the existing row. Race conditions handled via `23505` UNIQUE violation re-fetch.

### Auto-trigger responsibility

`provisionVirtualAccount()` is **not** called from `approveKyc()` — to avoid the KYC service importing the virtual-accounts service and making it responsible for external API calls. Instead, the admin KYC approval route (Block 7+) calls it after `approveKyc()` succeeds, catching and logging DVA provisioning failures separately (KYC approval must not fail because Paystack is slow).

### Inbound transfer crediting

```
Paystack fires charge.success (channel=dedicated_nuban)
→ handleDvaTransferWebhook() verifies signature
→ looks up virtual_accounts by account_number
→ calls creditWallet(userId, { idempotencyKey: 'dva:{reference}:CREDIT', ... })
→ ledger_entries UNIQUE constraint deduplicates retries
```

Event field `data.channel === 'dedicated_nuban'` distinguishes DVA inbound from topup payments.

---

## Consequences

**Good:**
- One bank account number per user, persistent — no per-transaction setup.
- Inbound transfer deduplication via existing ledger idempotency layer.
- Provisioning failure is isolated from KYC approval (separate concerns).
- `PAYSTACK_DVA_BANK` env var makes the preferred bank configurable without code changes.

**Bad / trade-offs:**
- Paystack DVA has per-account provisioning fees (variable).
- Paystack only supports certain banks for DVA (Wema, Sterling). Default `wema-bank` may change — must monitor Paystack changelog.
- No re-provisioning on bank failure; need a manual admin endpoint to reprovision (future work).

---

## Alternatives rejected

- **Per-transaction virtual accounts**: Paystack supports ephemeral virtual account numbers per transaction but they expire. Rejected — users expect a persistent account they can share.
- **Shared pool of virtual accounts**: Too complex, requires matching inbound amounts to senders.
