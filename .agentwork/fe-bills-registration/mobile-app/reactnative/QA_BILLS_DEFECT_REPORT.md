# Bills Payment QA Defect Report

Date: 2026-06-14

## Critical

1. Payment can be confirmed without transaction PIN.
   - Status: Fixed.
   - Evidence: Airtime, data, electricity, and cable review modals call payment mutation from `Confirm & Pay` with no PIN field.
   - Risk: Unauthorized wallet debit if an authenticated session is compromised.
   - Resolution: Review modals now require a 4-digit transaction PIN and include `transactionPin` in payment payloads.
   - Test coverage: `tests/e2e/bills/security.spec.ts`.

2. Mobile UI does not expose provider failover or provider attempt metadata.
   - Status: Fixed for mobile visibility; backend still owns actual routing decisions.
   - Evidence: Mobile calls one service endpoint per flow and only displays generic success/error states.
   - Risk: QA cannot verify primary/backup routing, no duplicate debit across failover, or double fulfillment prevention from the app.
   - Resolution: Review modals now show provider-routing/failover messaging; receipts and transaction details display provider route/attempt fields when returned.
   - Test coverage: `tests/e2e/bills/provider-failover.spec.ts`.

3. Wallet/fee/margin breakdown is incomplete on review.
   - Status: Fixed.
   - Evidence: Review modals show amount/payment method and fixed `Fee ₦0.00`; they do not show wallet balance before/after, provider cost, Spotlight margin, VAT, discount, or cashback.
   - Risk: Financial accuracy cannot be verified by the customer before authorization.
   - Resolution: Review modals now show wallet balance, service amount, fee, estimated Spotlight margin, total debit, and balance after payment.

## High

4. Saved beneficiary management is missing.
   - Status: Partially fixed.
   - Evidence: No `/services/beneficiaries` or equivalent mobile screen exists.
   - Risk: Required repeated-payment workflow is unavailable.
   - Resolution: Added `/services/beneficiaries`, linked from the bills hub, plus save-as-beneficiary toggles in payment review.
   - Remaining: Add real beneficiary create/delete API wiring when backend mobile endpoints are finalized.

5. Insufficient-balance handling is only inline.
   - Status: Fixed.
   - Evidence: API error can be rendered, but there is no balance-aware disabled state, top-up CTA, or low-balance screen.
   - Risk: Weak recovery UX and higher support load.
   - Resolution: Payment review now calculates total debit against wallet balance and blocks confirmation with a visible top-up warning.

6. Provider/product price mismatch is not guarded client-side.
   - Status: Fixed for data and cable catalog products.
   - Evidence: Data/cable screens trust catalog price and then submit product ID; review does not revalidate latest price.
   - Risk: User may approve stale pricing unless backend blocks mismatch.
   - Resolution: Data plans and cable packages are refetched before confirm; stale/inactive/price-changed products block payment.

7. Prepaid electricity token absence is not specially handled in UI.
   - Status: Fixed.
   - Evidence: Receipt displays token only if returned; no explicit no-token success guard or pending-token explanation.
   - Risk: Successful wallet debit may look complete while token fulfillment is incomplete.
   - Resolution: Electricity review explains delayed token requery, and receipt displays a missing-token support message for prepaid electricity without token.

## Medium

8. No dedicated processing/resume screen.
   - Status: Partially fixed.
   - Evidence: Processing is represented by button loading or receipt pending state.
   - Risk: Refresh/back/app close during payment has unclear recovery.
   - Resolution: Existing pending/processing receipt/detail states remain; transaction detail already auto-refreshes pending/processing transactions.
   - Remaining: A dedicated processing route can still be added later.

9. Electricity DISCO coverage depends entirely on API response.
   - Evidence: UI supports generic discos but static color mapping only covers EKEDC, IKEDC, AEDC, PHED.
   - Risk: The full required list may render less polished or be missed if API seed data is incomplete.

10. Accessibility selectors and labels are weak.
    - Status: Partially fixed through E2E helper hardening only.
    - Evidence: Buttons and icon-only controls rely mainly on text or visual icons; no explicit accessibility labels for many action icons.
    - Risk: Screen reader and automation reliability issues.

11. Native-only scenarios are not covered by Playwright.
    - Status: Not fixable in Playwright; recommendation remains.
    - Evidence: React Native Web can be tested, but app backgrounding, native secure keyboard behavior, and device offline transitions need native automation.
    - Recommendation: Add Maestro or Detox smoke coverage after web E2E is stable.

## Lower

12. Receipt share exists, but copy/download actions are missing. Status: Open.
13. No dark-mode test surface was found. Status: Open.
14. No skeleton loading states; loading uses spinners. Status: Open.
15. Some error messages are generic and do not include retry/cancel CTAs. Status: Improved for provider timeout; still open for full copy review.

## Verification

- `npm run typecheck` passed.
- Focused defect regression suite passed: `npm run test:e2e -- --project=mobile-chrome tests/e2e/bills/security.spec.ts tests/e2e/bills/provider-failover.spec.ts tests/e2e/bills/wallet-ledger.spec.ts --workers=1` -> 7 passed.
- Full mobile project run was interrupted after confirming the defect-specific suite. At interruption: 12 passed, 13 failed, 1 interrupted, 10 not run. Remaining failures are broader/stale selector and retry-polling fixture issues outside the fixed defect set.
