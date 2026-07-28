# Caveats to Verify & Open Decisions

## Maplerad integration caveats — verify in sandbox BEFORE live

1. **Virtual account naming** — reported random account names; `bankName` returns "maplerad". Confirm live-mode behaviour and the correct payer-facing label/instructions.
2. **Bills sync vs async** — docs imply both a success response and a webhook. Treat webhook as authoritative; make the result idempotent across both paths.
3. **VA webhook payload** — confirm exact fields on inbound credit (amount, payer, reference) and map to the ledger credit.
4. **USD dual-wallet (phase 2)** — USD splits into SPEND (cards) vs TREASURY (all else); route USD logic by wallet type. NGN unaffected.
5. **Provider disruptions** — Maplerad's status history shows periodic partner/processor incidents; design for graceful degradation (queue, retry, circuit-break).

## Compliance check (confirm with Maplerad + counsel)

- Confirm which **licensed entity** holds the float and how the **trust/settlement** account is structured, so wallet balances legally rest on the provider's licensed structure, not Paymax's. This is the compliance core of the arrangement.

## Open commercial decisions (architecture-neutral)

- Phase-2 timing for USD wallets, Issuing (cards), Forex.
- Bills via Maplerad **Bills** vs an existing bill-pay provider behind the same gateway.
- Per-tier transfer/VA limits (policy atop the KYC gate).
- Fee/markup policy on transfers and FX.
- Sole-provider vs keep a second adapter live for failover (gateway makes this a config choice).
