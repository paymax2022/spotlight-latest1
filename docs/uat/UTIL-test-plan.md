# UAT Test Plan — Module 2: Utility Bills

Source: Phase 1 discovery note (2026-09-15, see engagement chat log for full text). Scope: `frontend-web/` (the entire implementation — there is no Go backend for this module, see UTIL-005), `mobile-app/reactnative/`. No `frontend-admin` involvement — no admin surface for this module exists anywhere (UTIL-001).

Legend: [ ] not run · [x] pass · [!] fail (see bug ID)

## Open decisions needed from user before some items can be fully closed
1. **UTIL-005**: is "the entire module lives in Next.js, no Go backend" an accepted permanent architecture (there's an ADR precedent, ADR-040, for accepting Next.js as a money-moving plane) or does it need remediation before go-live?
2. **UTIL-004**: is "KYC Tier-1 not enforced for bills" an accepted product decision, or does it need to be added?
3. Which provider mode (VTpass live/sandbox, or the separate `sandbox` adapter) is actually configured in the environment being tested?

## A. Purchase flow — electricity
- [ ] A1. Prepaid electricity: valid meter, valid amount → payment succeeds, wallet debited exactly once, token/receipt returned
- [ ] A2. Postpaid electricity: valid meter, valid amount → payment succeeds
- [ ] A3. Invalid/nonexistent meter number → validation rejects before any debit
- [ ] A4. Amount below/above category min/max bounds → rejected with clear message
- [ ] A5. Insufficient wallet balance → rejected, no debit attempted
- [ ] A6. Prepaid token delivery failure path — per mobile QA doc item 7 ("may complete without a token, needs support message") — verify current behavior live, not the doc's claim
- [ ] A7. DISCO coverage in mobile UI — per mobile QA doc item 9, static color mapping only covered EKEDC/IKEDC/AEDC/PHED — check current state for other DISCOs

## B. Purchase flow — airtime / data
- [ ] B1. Airtime top-up, valid phone number, valid amount → succeeds
- [ ] B2. Data bundle purchase → succeeds, correct bundle applied
- [ ] B3. Invalid phone number format → rejected client + server side
- [ ] B4. Network/operator auto-detection (if present) correctly identifies carrier from phone prefix

## C. Purchase flow — cable TV
- [ ] C1. DStv/GOtv/Startimes subscription renewal, valid smartcard/IUC → succeeds
- [ ] C2. Invalid smartcard number → validation rejects before debit
- [ ] C3. Package/bouquet change reflects correct pricing

## D. Idempotency & failure handling
- [ ] D1. Duplicate request with the same `Idempotency-Key` → returns the original result, does NOT double-charge (early return per `service.ts:552-557`)
- [ ] D2. Missing `Idempotency-Key` header → 400, no side effects (per `app/api/bills/_utils.ts:77-78`)
- [ ] D3. Provider failure on the first route → failover to next viable route (per `service.ts:664-701`) — verify with a forced provider failure if a test/sandbox hook allows it, otherwise code-review confirm and note as not live-tested
- [ ] D4. All routes exhausted / all providers fail → wallet debit is reversed (`reverseWalletDebit`), verify ledger nets to zero for that transaction (no integration test currently covers this end-to-end per discovery — this is exactly the gap to close live)
- [ ] D5. Provider timeout → transaction correctly lands in `pending`, not silently dropped or falsely marked failed/successful
- [!] D6. **UTIL-002**: a transaction stuck in `provider_pending` has no reachable automatic or manual resolution path today — confirm current impact (any real stuck transactions in the target environment?) as part of sign-off

## E. Wallet/ledger correctness (money-path, per CLAUDE.md iron rules)
- [ ] E1. A successful purchase produces a balanced double-entry ledger posting (debit wallet, credit... whichever leg the journal design uses) — verify via direct ledger query, not just UI balance
- [ ] E2. A reversed purchase (D4) nets the ledger to zero for that transaction — no residual unbalanced leg (this is the exact class of bug ADR-040 already found once)
- [!] E3. **UTIL-003**: commission/profit recorded for a transaction does NOT yet post to the ledger (`ledger_ref` stays null) — confirm this is understood and accepted for this sign-off, since profitability reports read unreconciled numbers
- [!] E4. **UTIL-004**: confirm live whether a purchase that would exceed KYC Tier-1 limits (if tier limits applied elsewhere in the platform) is still allowed through this module — expected per code to succeed since tier checks are intentionally skipped; confirm this matches the accepted product decision
- [ ] E5. Wallet daily-spend limit (the one limit that IS enforced) actually rejects a purchase that would exceed it

## F. Beneficiaries / saved billers
- [ ] F1. Save a beneficiary (meter/phone/smartcard) → appears in list, reusable on next purchase
- [ ] F2. Delete a saved beneficiary → removed, no longer offered
- [ ] F3. Per mobile QA doc item 4 ("saved beneficiary management is missing, claimed partially fixed") — verify current live state

## G. Security
- [ ] G1. Per mobile QA doc item 1 ("payment can be confirmed without transaction PIN, claimed fixed") — **live-verify this specifically**, do not accept the doc's "Fixed" claim at face value (same lesson as AUTH-021 in Module 1: a claimed-fixed defect can still be live)
- [ ] G2. Price/quote staleness — if a quote is fetched then the purchase is submitted after a delay, does the actual charge match the quoted price or re-validate? (mobile QA doc references a "stale-price guard")
- [ ] G3. Purchasing on behalf of another account / IDOR check on transaction history and beneficiary endpoints (does `GET /transactions/:id` scope to the authenticated user?)

## H. Transaction history & receipts
- [ ] H1. Transaction history list shows accurate status per transaction (successful/pending/failed/reversed)
- [ ] H2. Receipt view/download for a successful transaction shows correct amount, reference, provider details
- [ ] H3. Requery a pending transaction (if a UI path exists for the end user, not just admin) updates status correctly when the provider has since confirmed

## I. Admin portal (currently unreachable — UTIL-001)
- [ ] I1. **Blocked by UTIL-001** — once an admin page is wired up (or via direct authenticated API call as an interim test method): transaction monitoring list matches real `utility_transactions` data
- [ ] I2. **Blocked by UTIL-001**: reverse/resolve actions on a transaction actually change its state and trigger the correct wallet-side effect
- [ ] I3. **Blocked by UTIL-001**: provider/biller/product/routing-rule CRUD actually affects live purchase routing
- [ ] I4. **Blocked by UTIL-001**: profitability/reconciliation reports — note UTIL-003 means these are not ledger-reconciled regardless of UI reachability
- [ ] I5. Even without a UI, spot-check the admin API endpoints directly (authenticated curl) to confirm they function correctly server-side, separating "the logic works" from "nobody can reach it" as two distinct findings

## J. Feature flag & cross-cutting
- [x] J1. `FEATURE_UTILITY_PAYMENTS_ENABLED` gate confirmed present at every consumer and admin route entry point (code-reviewed, satisfies CLAUDE.md's flag-every-module rule) — live-verify the flag-off 503 behavior
- [ ] J2. Mobile ↔ web consistency: both correctly point at the same Next.js implementation (not the Go backend) — confirmed in discovery as consistent (unlike Module 1's web-vs-mobile auth split), but verify live that a purchase made on mobile shows up correctly in web transaction history and vice versa
- [ ] J3. Per `.github/workflows/staging-module-flags.yml`'s documented past incident (module-key mismatch between mobile's `serviceModuleKeys.ts` and Go's `modulegate/routes.go` caused utility tiles to silently vanish) — confirm the union-check compensation actually holds in the current staging config, not just that CI has a line for it
- [ ] K1. Mobile QA doc's own regression run was interrupted (12 passed, 13 failed, 1 interrupted, 10 not run per discovery) — get a current, complete run before trusting any of its coverage claims
