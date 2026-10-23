# ADR-PR837: Card-direct parcel checkout includes the insurance premium

**Status:** Accepted · **Date:** 2026-10-17 · **Area:** transport / card-direct / insurance money path · **Flag:** `FEATURE_PARCEL_PREPAID_INSURANCE` (with the card-direct parcel flags) · **Builds on:** ADR-PR836

## Context
ADR-PR836 made parcel insurance an opt-in tick paid at booking from the wallet. The card-direct rail (Paystack, no wallet, no KYC-tier gate) refused `insure` with 422 `INSURANCE_CARD_NOT_SUPPORTED`. Card money must never be credited to a wallet: that would give a Tier-0 sender spendable balance funded by an external charge.

## Decision
1. **Charge.** With `insure: true`, initiate quotes fare + the estimate's premium and freezes the premium next to the fare (`parcelFrozenPricing.InsuranceKobo`). A rate change between initiate and confirm cannot cause a mismatch. Ineligible insured checkouts (no declared value, insurer not wired, incomplete profile) are refused at initiate, before anything is stored. The wallet-balance check does not apply.
2. **Split on confirm.** The verified amount must equal fare + premium. The premium moves `provider_clearing → insurance_premium_hold` (key `<ref>:insurance`, reference `parcel:insurance_hold_card:<ref>`). The fare is escrowed with `EscrowExternal` under `<ref>:fare`. Both are keyed off the charge reference, so every replayed confirm converges on one hold, and a replay that resolves to a different posting is refused.
3. **The charge funds two pieces.** Because the fare is `<ref>:fare`, a cancel refunds it through the existing piece-refund path, never as the whole charge. The premium is a new kind of piece, a **ledgerless piece** (`piece:parcel_insurance_premium`). The engine refunds it to the card with the same fenced, lookup-first machinery. It records the piece in `transport_paystack_intent_refunds` and counts it against the refund cap, so refunds can never exceed what was collected.
4. **Gateway first, ledger second.** Transport asks the parcel refunder to refund the piece. Only after the gateway holds the refund does it post the ledger leg back to `provider_clearing`:
   - from the hold, under `<ref>:insurance_refund` (bind refused, cancel before the bind, reconciler);
   - from `paymax_revenue`, under `parcel:insurance:<id>:cancel_refund` (cancel after the bind; the platform absorbs it, as on the wallet rail).

   The two ledger keys exclude each other, and the gateway piece key is shared, so the premium is refunded at most once on both sides.
5. **The bind saga returns card premiums to the hold.** `policy.BindFromQuotePrepaidToHold` sends a refused bind's premium `clearing → hold` under the saga's usual `<bindKey>:reversal` key. It sends no wallet notice; transport then refunds the hold to the card. A binder without this method does not bind a card premium, and the premium is refunded.
6. **Unbooked charges.** A Book that held the premium and then failed is unwound by a new optional engine seam, `LedgerUnwinder`. The parcel implementation is `UnwindParcelPremiumHold`, which posts hold → clearing under `<ref>:insurance_refund`. The engine calls it before refunding the whole charge, in both the live path and the reconciler. An unwind failure blocks the refund until it can be retried, the same as a failed settlement reversal. The wallet orphan sweep never touches card holds.
7. **Reconciliation.**
   - `ReconcileParcelInsurance` is funding-aware. For a card premium, the saga reversal means "back in the hold", not "refunded".
   - It now also sweeps stale `refunded` rows that have no refund on the ledger. These are left by a crash between claiming a refund and the refund itself, which is more likely when the refund is a gateway call.
   - The engine sweep resolves stranded ledgerless pieces at the gateway only. Transport posts the ledger leg.

## Consequences
- 422 `INSURANCE_CARD_NOT_SUPPORTED` is gone.
- Insured card parcels use a piece-keyed fare settlement (`<ref>:fare`). Uninsured card parcels and wallet parcels are unchanged.
- If the flag is turned off between initiate and confirm, an insured charge no longer matches the fare, so the whole charge is refunded. The same happens when a sender's profile becomes incomplete before confirm.
- A premium refund may wait behind an in-flight fare refund (one piece in flight per charge). It is left `refund_failed` and retried by the reconciler.
- The customer notice names the card ("refunded to the card you paid with"). Push delivery is still log-only (ADR-PR836).
