# ADR-PR884 — Remove Maplerad; Paystack is the sole payment/VA provider

- **Status:** Accepted
- **Date:** 2026-10-23
- **Deciders:** money-path (payments / FX / orchestration)
- **Related:** ADR-PR798 (VertoFX default provider), ADR-012 (Maplerad WaaS, superseded for runtime), ADR-030 (FX markup)

## Context

Maplerad was wired three ways: as the generic `paymentProvider` and `vaProvider`
(overriding Paystack whenever `MAPLERAD_SECRET_KEY` was set), as the legacy
wallet-FX provider (`finance/fx`), and as an FX-orchestration adapter, card
issuer and WaaS domain (`finance/maplerad`). Maplerad is no longer used.

The override was also a live bug: academy tuition confirm verifies a Paystack
checkout reference through `paymentProvider`, so with a Maplerad key present it
asked Maplerad about a Paystack reference, got a non-success status and returned
`payment_not_confirmed` for charges Paystack had settled.

## Decision

1. **Delete Maplerad outright** — provider client, `finance/maplerad` module,
   orchestration adapter, `/api/webhooks/maplerad/go`, `/api/finance/maplerad/*`,
   `MAPLERAD_*` config and `FEATURE_MAPLERAD_ENABLED`. No shim, no dead flag.
2. **Paystack is the only payment and VA provider.** `paymentProvider` is never
   overridden, so every Paystack-reference verifier (tuition, dues, fees, food)
   checks the gateway that took the money.
3. **FX orchestration = Eversend + VertoFX.** The preferred virtual-account
   provider becomes `vertofx` (iban stays `eversend`), replacing the hard-coded
   `maplerad` preference.
4. **Capabilities with no replacement are switched off, not faked.**
   FX virtual cards (`/api/v1/fx/cards*`) are unmounted; the legacy wallet FX
   quote/convert service keeps its code behind an unimplemented `fx.Provider`
   interface and is not mounted. The FX markup admin route is always mounted
   (it never depended on Maplerad).
5. **History is not rewritten.** Existing migrations (additive-only), ADRs, audits
   and QA records keep their Maplerad references. The `mpr_` pattern stays in
   `scripts/check-client-secrets.sh` so leaked legacy keys are still caught.

## Consequences

- Tuition and other Paystack confirmations no longer depend on which optional
  provider keys are set.
- Anything that relied on Maplerad for NGN DVAs, payouts, bills or cards has no
  provider until one is chosen. `orch_fx_cards.provider` defaults to `'maplerad'`
  in the schema; new rows write `'internal'`, and old rows are left as-is.
- Legacy `fx.Service` quote/convert is dead code until a provider implements
  `fx.Provider`; delete it if none is planned.
- Deploys should drop `MAPLERAD_*` env vars; they are now ignored.
