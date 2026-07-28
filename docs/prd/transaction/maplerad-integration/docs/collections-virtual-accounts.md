# Collections — Virtual Accounts (NGN)

A virtual account is a **collection rail** into Maplerad custody, reflected as the user's internal balance. It is not a stored-balance license; custody/compliance sits with Maplerad's licensed structure.

## Issuance

- Gate on KYC tier → `VirtualAccountPort.openVirtualAccount(customerId)` → Maplerad **Collections**.
- Persist `{accountNumber, bankName, accountName}` against the user. NGN only in v1.

## Inbound credit flow

```
Payer bank transfer → Maplerad inbound-credit webhook
  → verify signature → dedupe by event id → post ledger CREDIT (idempotent, keyed by event ref) → notify user
```

- Do not poll for credits; rely on the webhook.
- Confirm the exact webhook payload fields (amount, payer, reference) in sandbox and map them to the credit posting.

## Caveats to verify before live (see caveats-and-decisions.md)

- Virtual-account **name** has been reported as random / not the customer's name, and `bankName` returns "maplerad". Confirm live-mode naming and present correct payer-facing instructions/label.
