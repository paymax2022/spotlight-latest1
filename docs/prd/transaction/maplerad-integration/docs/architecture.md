# Architecture

## Custody vs ledger of record

Maplerad holds the funds (its licensed-partner balance sheet). Paymax keeps the **ledger of record** for user-facing balances. Neither is skipped:

| Layer | Owns | Notes |
|---|---|---|
| Internal ledger (Paymax) | Truth for displayed balances | Append-only entries; balance derived by summation. |
| Maplerad | Custody + settlement of real money | Reflected into the ledger via confirmed events. |
| Reconciliation | Agreement between the two | Scheduled; drift quarantined + alerted. |

**Rule:** the hot path reads the internal ledger (cache-friendly, offline-first). Maplerad is only called to *move* money or *provision* resources, and its outcomes post to the ledger on confirmation.

## Layering

```
domain services
      │ (call ports only)
gateway ports:  WalletPort · VirtualAccountPort · TransferPort · BillsPort · IdentityPort
      │ (one implementation)
MapleradAdapter  ──HTTP/SDK──►  Maplerad (sandbox | live)
```

Domain code must never reference Maplerad types. Mappers in the adapter translate Maplerad DTOs ⇄ domain models. Swapping or adding a provider later touches `/adapters` only.

## Customer mapping

- 1 Paymax user ↔ 1 Maplerad customer, created when the user reaches the required KYC tier.
- Reuse existing tiered KYC; forward BVN/NIN to Maplerad **Identity**; persist `maplerad_customer_id`.
- Capability (VA issuance, transfer limits) is gated by the existing KYC tier *before* any Maplerad call.

## Wallet model

- A user's NGN position is a derived sum of internal ledger entries; the Maplerad **Wallet** is the custody mirror.
- In-flight debits reserve via a `PENDING` ledger entry; finalized or reversed on settlement.
- Phase 2: USD wallet splits into SPEND (cards) and TREASURY (everything else) — route USD by wallet type. NGN unaffected.
