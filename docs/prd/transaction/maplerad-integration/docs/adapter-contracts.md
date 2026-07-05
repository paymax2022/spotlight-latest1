# Adapter Contracts

Gateway ports are stable. The Maplerad adapter implements them using these resources:
**Identity, Wallets, Collections, Transfer, Counterparty, Institutions, Bills, Transactions.**

## Conventions for every method

- Accept a **client reference** (idempotency key); pass it to Maplerad and reuse it as the ledger posting reference.
- Return domain models, never Maplerad DTOs.
- Terminal money state is confirmed by webhook (see `webhooks.md`), not by the sync return.

## Ports → Maplerad mapping

### IdentityPort
- `createCustomer(user, kyc) -> maplerad_customer_id` → Maplerad **Identity** (BVN/NIN).
- `getCustomer(id)`.

### WalletPort
- `provisionWallet(customerId, currency=NGN)` → Maplerad **Wallets**.
- `getProviderBalance(walletId)` → used by reconciliation **only**, not the hot path.

### VirtualAccountPort
- `openVirtualAccount(customerId) -> {accountNumber, bankName, accountName}` → Maplerad **Collections** (NGN).
- Inbound credits arrive via webhook, not polling.

### TransferPort
- `resolveInstitution(query)` → cached **Institutions** list.
- `upsertCounterparty(bankCode, accountNumber)` → **Counterparty**.
- `initiateTransfer({ref, amount, counterparty}) -> {providerRef, status=PENDING}` → **Transfer**.
- `getTransfer(providerRef)` → for orphan re-query.

### BillsPort
- `purchase({ref, type, params}) -> result` → **Bills**. Treat as async-authoritative; reconcile sync result with webhook (idempotent on `ref`).

## Idempotency

- Persist `(ref -> provider operation)` before the call. On retry with the same `ref`, return the stored result instead of re-calling.
- Ledger postings are keyed by `ref`; a duplicate post is a no-op.
