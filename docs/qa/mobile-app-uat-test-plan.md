# Mobile App — Workflow & UAT Test Plan (All Modules)

**Scope:** every module in `public.platform_modules` (see
`supabase/migrations/20261210000000_platform_module_registry.sql`), from the
mobile app's (`mobile-app/reactnative`) point of view: what screen a user
opens, what they do step by step, and a pass/fail checklist to run against it.

**How this relates to `docs/qa/modules/`:** those files are the deep,
backend-endpoint-centric test matrices (Case IDs, layer coverage, FSMs). This
document is the mobile-workflow companion — it says *where in the app* a
tester goes and *what they tap*, and links to the deep-dive doc for full
backend coverage where one exists. Where this doc and a `docs/qa/modules/*.md`
file disagree, treat the code as ground truth and flag the doc that's stale.

**Legend:** ✅ deep-dive doc exists at `docs/qa/modules/<slug>.md` · ⚠️ gap or
known issue found while researching this doc (grounded in code, not
speculation) · 🚫 no dedicated mobile screen found for this module today.

**Global preconditions for any case below (don't repeat per module):**
- A signed-in test user (see `scripts/dev/ensure-dev-login.sh`), with a
  transaction PIN set where the flow moves money.
- The module's `FEATURE_<KEY>_ENABLED` flag is `true` in the environment
  under test — every flag defaults `false`, so an "it doesn't show up" result
  is a config check first, not necessarily a bug.
- Money-path steps assume a funded wallet at the required KYC tier; note the
  tier explicitly where a module gates on it.
- Every write should carry an `Idempotency-Key`; "replay same key" is a valid
  case for any module marked money-path, even where not spelled out below.

---

## Contents

- [Finance (13)](#finance) — wallet, kyc, virtualAccounts, insurance, savings, fintechAdmin, tierLimits, checkoutTopupTier0, utilityPayments, walletTransfers, walletBankTransfers, beneficiaries, fx
- [Voting (2)](#voting) — votesBridge, voteBridge
- [Growth (3)](#growth) — referrals, creators, loyalty
- [Health (5)](#health) — health, healthPharmacy, healthLab, healthVet, telemedicine
- [Community (4)](#community) — groups, estate, crowdfunding, association
- [Commerce (3)](#commerce) — stays, events, restaurant
- [Social (1)](#social) — socialPay
- [Mobility (1)](#mobility) — transport
- [Property (1)](#property) — realtor
- [Ops (3)](#ops) — aiCare, disputes, ratings

---

## Finance

### wallet ✅ (`docs/qa/modules/wallet.md`)
**Mobile:** `app/(tabs)/wallet.tsx` (balance, tabs, Add Money/Send/Withdraw/Exchange) → `app/wallet/add.tsx` → `app/wallet/transaction/[id].tsx`.
**Workflow:** open Wallet tab → view balance & ledger → tap Add Money → enter amount → Paystack checkout → return to app → balance updates → open the new entry under Transactions.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| WAL-1 | Signed in, `FEATURE_WALLET_ENABLED=true` | Open Wallet tab | Balance, currency toggle, action buttons and transaction list render |
| WAL-2 | — | Tap Add Money, enter ₦99 (below ₦100 min) | Blocked client-side before hitting the API |
| WAL-3 | — | Add ₦5,000 via Paystack, complete checkout | Wallet credited exactly once; entry appears in Transactions |
| WAL-4 | — | Cancel/fail the Paystack checkout mid-flow | Wallet balance unchanged; no phantom transaction row |

### kyc
**Mobile:** `app/kyc.tsx` (status + Initiate) and the fuller capture flow `app/kyc-verify/*` (requirements → id-type → id-number → document → selfie → address → consent → pending/success/failed).
**Workflow:** open Identity Verification → see current tier/status → submit ID type + requested tier + document/selfie → status → "pending" → tier upgrades on approval → NGN virtual account auto-provisions once tier ≥1.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| KYC-1 | Tier 0 account | Open KYC screen | Current tier and "not verified" state shown |
| KYC-2 | — | Submit a valid ID + selfie for Tier 1 | Status flips to pending/submitted |
| KYC-3 | Status already `pending` | Try to re-submit | Rejected — a second submission while pending must not silently double-queue |
| KYC-4 | Approved to Tier 1 | Reopen Wallet → bank-transfer screen | Dedicated virtual account now appears (see `virtualAccounts` below) |

### virtualAccounts
**Mobile:** 🚫 no dedicated screen — surfaced inside `app/wallet/bank-transfer.tsx` (shows the auto-provisioned account for funding by transfer).
**Workflow:** Wallet → bank-transfer/fund-by-transfer → view NGN account number/bank → copy/share → send funds externally → wallet credited on provider webhook.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| VA-1 | Tier 0 (no BVN) | Open bank-transfer screen | Refused / prompts KYC — Tier 1 is required to provision an account |
| VA-2 | Tier 1+ | Open bank-transfer screen | A real dedicated account number + bank name is shown, not a placeholder |
| VA-3 | Account already provisioned | Reopen the screen later | Same account number returned (not re-provisioned each time) |
| VA-4 | ✅ Verified correct 2026-09-22 | Open the screen | Already handled: `GetOrProvision` returns typed `ErrProviderUnavailable` when `vaProvider == nil` (`internal/finance/va/service.go:58`), mapped to a clean `503` with a clear message (`handler.go:32`); mobile's `isError` catch-all renders a "Couldn't load your account" retry state, not a crash (`app/wallet/bank-transfer.tsx:61`). No code change needed. |

### insurance ✅ (`docs/qa/modules/insurance.md`)
**Mobile:** `app/insurance/quote/form.tsx → review.tsx` → `opt-in/wallet.tsx` → `pay/success.tsx`/`failure.tsx` → `policies/[id]/*` → `claims/start.tsx → status.tsx`.
**Workflow:** browse products → get a quote → review → opt in to wallet debit → pay premium → policy appears under Policies → file a claim → track claim status.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| INS-1 | Funded wallet | Get a quote and review | Premium and terms match the product selected |
| INS-2 | — | Pay premium | Policy created, appears under `policies/[id]` |
| INS-3 | An existing active policy | Cancel it, then try cancelling again | Second cancel rejected (`ErrBadState`) — no double-cancel |
| INS-4 | Another user's policy id | Try to open it directly | 403 — can't view someone else's policy |

### savings ✅ (`docs/qa/modules/savings.md`)
**Mobile:** `app/savings/index.tsx` → `vault/create.tsx`, `vault/[id].tsx`, `vault/auto-save.tsx`, `vault/early-withdraw.tsx`; also `target/*` (group targets), `ajo/*` (rotating circles).
**Workflow:** open Savings → create a vault with a goal/lock term → fund it from wallet → watch progress on the vault detail screen → withdraw at maturity or early (with penalty).

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| SAV-1 | Funded wallet | Create a vault, fund ₦10,000 | Vault balance and progress bar update |
| SAV-2 | Locked vault, before maturity | Attempt early withdraw | Penalty disclosed and applied, or blocked per product terms |
| SAV-3 | — | Attempt to withdraw more than the vault holds | Rejected (`ErrInsufficientVault`) |
| SAV-4 | Group target vault | Contribute before the release rule is met | Release blocked (`ErrReleaseRuleUnmet`) until satisfied |

### fintechAdmin 🚫 (admin console, not mobile)
**Where:** `frontend-admin` — `admin/payments-finance/adjustments/page.tsx` (maker-checker), `rbac-settings/page.tsx`.
**Workflow (2 admin accounts required):** maker submits an adjustment ≥₦100,000 → queued `pending_approval` → checker opens the adjustments list → approves or rejects with a note → maker cannot self-approve.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| FADM-1 | Maker account | Submit a ≥₦100,000 adjustment | Lands in `pending_approval`, not applied yet |
| FADM-2 | Same maker account | Try to approve their own submission | Rejected server-side |
| FADM-3 | Distinct checker account | Approve the adjustment | Adjustment applies; audit trail records checker identity |
| FADM-4 | Checker rejects | Reject without a `checker_note` | Rejected — a reason is mandatory |

### tierLimits 🚫 (enforcement mechanism, not a screen)
**Where enforced:** `backend/internal/finance/tiers/service.go` (`EnforceWalletDebitLimit`), called from wallet debit, utilitybills, transfers, transport, restaurant, marketplace, votebridge.
**Workflow (verification test, not a user journey):** Tier 0 account → any wallet debit attempt → blocked → complete BVN to reach Tier 1 → spend up to the daily cap → exceed it → blocked again.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| TIER-1 | Tier 0 account | Attempt any wallet debit (transfer, bill pay, etc.) | Blocked with `ErrWalletDisabled` |
| TIER-2 | Tier 1 account (₦50k/day cap) | Spend exactly ₦50,000 in one day across any combination of flows | Allowed |
| TIER-3 | Same account, same day | Attempt one more debit of any size | Rejected — `ErrDailyLimitExceeded` |
| TIER-4 | Tier 3 account | Spend a large amount (e.g. ₦5,000,000) | Allowed — Tier 3 is unlimited |

### checkoutTopupTier0 🚫 (checkout behavior, not a screen)
**Applies at:** `app/food/checkout.tsx`, events checkout, transport ride payment.
**Workflow:** Tier 0 account, flag on → fund wallet by card up to ₦20,000/24h (web topup gate) → pay ≤₦10,000 per checkout → repeat until the rolling 24h allowance is used up.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| CT0-1 | Tier 0, flag on | Checkout for ≤₦10,000 | Allowed under the capped allowance |
| CT0-2 | Same day | Checkout for >₦10,000 in a single purchase | Rejected — `ErrCheckoutAllowanceExceeded` |
| CT0-3 | Cumulative spend near ₦20,000 in 24h | One more checkout that would cross it | Rejected even though the single amount is under the per-purchase cap |
| CT0-4 | Flag off | Any Tier 0 checkout attempt | Falls back to the plain tier gate (`ErrWalletDisabled`) |

### utilityPayments
**Mobile:** `app/services/{airtime,data,electricity,cable-tv,education}.tsx`, hub at `app/services/bills.tsx`.
**Workflow:** pick a category → validate customer/meter/smartcard number → get a quote → pay → view receipt; requery if a payment appears stuck.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| UTIL-1 | — | Enter a valid meter/smartcard number | Validates and shows the customer name |
| UTIL-2 | — | Enter an invalid number | `ErrCustomerValidationFailed`, no charge attempted |
| UTIL-3 | Amount outside the category's allowed range | Attempt payment | `ErrCategoryAmountOutOfRange` |
| UTIL-4 | Already at the category's daily cap | Attempt one more payment | `ErrCategoryDailyLimit` |
| UTIL-5 | Payment stuck in a pending state | Use requery/retry | Resolves to a final state without double-charging |

### walletTransfers ✅ (`docs/qa/modules/transfers.md`)
**Mobile:** `app/wallet/send.tsx` (shared `PaymentActionScreen kind="transfer"`).
**Workflow:** tap Send → enter recipient phone/email → resolve Paymax account → enter amount → confirm with PIN → instant wallet-to-wallet settlement.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| WTX-1 | Valid recipient | Send ₦1,000 | Recipient credited, sender debited, both see the entry |
| WTX-2 | — | Enter a phone/email with no Paymax account | `ErrRecipientNotFound` (404) |
| WTX-3 | Phone shared by 2 accounts | Send to that phone | `ErrAmbiguousRecipient` (409) — must disambiguate |
| WTX-4 | — | Send to your own account | `ErrSelfTransfer` (422) |
| WTX-5 | Already at daily transfer cap | Send one more | `ErrDailyLimitExceeded`, with an "upgrade tier" prompt |

### walletBankTransfers ✅ (`docs/qa/modules/transfers.md`)
**Mobile:** `app/wallet/withdraw.tsx` (shared `PaymentActionScreen kind="withdraw"`).
**Workflow:** tap Withdraw → pick a saved beneficiary or add a new account → name auto-resolves → enter amount/narration → confirm with PIN → payout via Paystack Transfers → status settles async via webhook.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| WBT-1 | Funded wallet | Withdraw ₦2,000 to a valid saved account | Debited immediately; payout status updates async |
| WBT-2 | — | Enter an invalid account number/bank code | `ErrInvalidAccount`, name resolution fails before submit |
| WBT-3 | Balance below withdrawal amount | Attempt withdrawal | `ledger.ErrInsufficientFunds`, nothing debited |
| WBT-4 | Retry the same request | Resend with the same `Idempotency-Key` | Single payout only, no duplicate debit |

### beneficiaries
**Mobile:** 🚫 no standalone screen — managed inline in `app/wallet/withdraw.tsx`'s account picker (`app/services/beneficiaries.tsx` is a *different* list, scoped to utility-bill recipients).
**Workflow:** during a bank withdrawal, choose "New account" → enter bank + account number → name resolves → toggle "save" → confirm → beneficiary now reusable from the picker.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| BEN-1 | — | Add a new account and toggle "save beneficiary" during a withdrawal | Appears in the picker on the next withdrawal |
| BEN-2 | — | Enter an unresolvable account number | `ErrInvalidAccount`, not saved |
| BEN-3 | Saved beneficiary belonging to another user (should be impossible via UI) | Attempt to delete it by id | `ErrRecipientNotFound` / forbidden — no cross-account deletion |

### fx
**Mobile:** `app/fx/*` — `send/`, `convert/` (index → confirm → processing → success/failed), `receive/`, `beneficiaries/`, `cards/`, `kyc/`; entry tile at `app/services/fx.tsx`.
**Workflow:** Services → FX → complete FX-specific KYC if gated → Convert, pick currency pair/amount → review quote (spread applied) → confirm → processing → success/failed.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| FX-1 | Funded wallet, FX KYC complete | Convert NGN→USD at a valid amount | Quote honored at confirm time, wallet debited/credited correctly |
| FX-2 | Quote expired (wait past its TTL) | Confirm anyway | Rejected — must re-quote, not silently use a stale rate |
| FX-3 | Insufficient wallet balance | Attempt a conversion | Blocked before any provider call |
| FX-4 | ✅ Verified 2026-09-22 (API solid; no console exists) | (Admin-side) | API-side validation confirmed solid: `PercentToBPS` rejects too-precise values, `SetRate` rejects out-of-range (`internal/finance/fx/markup_store.go:148`), both surfaced as 400 with a clear message (`markup_handler.go:62-86`), backed by a DB `CHECK` constraint as a second layer. But there is no admin console page wired to `/api/finance/admin/fx/markup` at all — `frontend-admin/src/services/fxAdminService.ts` is explicit that this whole console surface is mock-only and refuses to fabricate success (matches the existing simulated-writes guard). Not a validation bug; it's a missing UI, out of scope for this pass — flagging as a real gap rather than building a new admin page here. |

---

## Voting

### votesBridge / voteBridge ✅ (`docs/qa/modules/votebridge.md`)
**Mobile:** 🚫 not its own screen — embedded in `app/voting/buy-votes.tsx` → `vote-success.tsx`/`vote-failed.tsx`/`vote-receipt.tsx`.
**Workflow:** open a contest → tap Buy Votes → submit vote count/amount → wallet debited (tier-checked) → success/failed screen → receipt.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| VOTE-1 | Funded wallet, `FEATURE_VOTE_BRIDGE_ENABLED` + wallet flag on | Buy 10 votes | Wallet debited exactly the quoted amount; vote count recorded |
| VOTE-2 | Insufficient balance or over tier limit | Attempt purchase | HTTP 402, no votes recorded |
| VOTE-3 | Same idempotency key resent | Retry the exact same purchase request | No double-debit, no duplicate votes |

---

## Growth

### referrals ✅ (`docs/qa/modules/referral.md`)
**Mobile:** `app/referral/onboarding/code-entry.tsx`, `(tabs)/home.tsx`, `home/my-code.tsx`, `invite/*`, `earnings/withdraw.tsx`.
**Workflow:** onboard → get your code → invite via contact picker or QR → referred user signs up under your code → reward accrues → check earnings summary → withdraw.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| REF-1 | New user | Enter a valid referral code during onboarding | Attribution recorded, referrer's pending reward created |
| REF-2 | — | Enter your own code | `ErrSelfClaim` — rejected |
| REF-3 | — | Enter an invalid/nonexistent code | `ErrInvalidCode` |
| REF-4 | Claim attempted after the grace window | Enter a code late | `ErrWindowClosed` |
| REF-5 | Reward accrued, unverified KYC | Attempt withdrawal | `ErrKYCRequired` / `ErrAccountNotEligible` (403) |

### creators ✅ (`docs/qa/modules/creators.md`)
**Mobile:** `app/creators/become-creator.tsx` → `index.tsx` → `storefront/[id].tsx`/`tip.tsx`/`subscribe.tsx` → `earnings.tsx`/`payout.tsx`.
**Workflow:** apply to become a creator → admin approves → publish content/subscription tier → fans tip/purchase/subscribe → check earnings → request payout.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| CRE-1 | Not yet approved | Attempt to publish content or request payout | `ErrCreatorNotApproved` |
| CRE-2 | Approved creator, unverified KYC | Request payout | `ErrPayoutKYC` — blocked until KYC verified |
| CRE-3 | Fan, funded wallet | Tip a creator | Creator's earnings balance increases |
| CRE-4 | Payout requested for more than available | — | `ErrInsufficientEarnings` |
| CRE-5 | Age-restricted / locked content, no access | Attempt to view | `ErrAgeRestricted` / `ErrContentNotAvailable` |

### loyalty ✅ (`docs/qa/modules/loyalty.md`)
**Mobile:** `app/loyalty/index.tsx` → `progress.tsx`, `catalog.tsx`, `redeem.tsx`, `tier-benefits.tsx`; `loyalty/black/*` for the top tier.
**Workflow:** view tier progress → browse the reward catalog → redeem a reward (points debited, never cash) → tier is re-evaluated (monotonic).

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| LOY-1 | Enough points, tier qualifies | Redeem a reward | Points debited, reward granted |
| LOY-2 | Tier below the reward's `MinTier` | Attempt redemption | `ErrTierTooLow` |
| LOY-3 | Not enrolled in Black | Attempt a Black-only perk | `ErrNotBlack` |
| LOY-4 | Black member at their monthly perk cap | Attempt one more Black perk redemption | `ErrPerkCapReached` |

---

## Health

### health (umbrella) ✅ (`docs/qa/modules/health.md`)
**Mobile:** `app/health/index.tsx` — hub tiles for pharmacy/lab/vet, Symptom Checker (`/health/triage`), consent (`/health/consent`).
**Workflow:** open Health tab → view hub summary → tap a vertical tile or Symptom Checker → drill into that sub-module.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| HLT-1 | `FEATURE_HEALTH_ENABLED=true` | Open Health hub | Summary and tiles render |
| HLT-2 | ✅ Verified correct 2026-09-22 | Open Health hub | Already handled: `app/health/index.tsx:44-51` — `isError \|\| !data` renders a "Couldn't load Health" `StateView` with a Retry button, not a blank screen or crash. No code change needed. |

### healthPharmacy ✅ (`docs/qa/modules/pharmacy.md`)
**Mobile:** `app/health/pharmacy/{index,symptom/index,symptom/results,symptom/refine,symptom/escalation,search,product/[id],cart,checkout,upload-rx,orders,rx-status}.tsx`.
**Workflow:** enter symptoms → view suggested OTC meds → refine or escalate to a pharmacist → add to cart → checkout (payment held) → pharmacist verifies Rx → dispense → track delivery.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| PHM-1 | — | Order an OTC item | Checkout succeeds, order tracked |
| PHM-2 | Item requires a prescription, no verified e-Rx | Attempt to confirm the order | Blocked pending pharmacist verification |
| PHM-3 | ✅ Verified correct 2026-09-22 | Attempt to list/order it | Stronger than a catalog filter: a hard DB `CHECK (is_controlled = false)` constraint (`supabase/migrations/20260815000200_health_pharmacy.sql:33`) makes it physically impossible for any row to ever have `is_controlled = true`, via any write path. Go-level rejection at create time (`service.go:288`) is defense-in-depth on top of that. No code change needed. |
| PHM-4 | NAFDAC-unregistered/banned product | Attempt to list/order it | Blocked from listing |

### healthLab ✅ (`docs/qa/modules/[none exact — see health.md]`)
**Mobile:** `app/health/lab/{index,catalog,packages,test/[id],book,home-collection,checkout,phlebotomist-tracking,test-status,results/[id],share-results}.tsx`.
**Workflow:** browse tests/packages → book (home or clinic) → checkout (payment held) → phlebotomist collects sample → lab processes → results released → view/share.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| LAB-1 | — | Book a home-collection test and pay | Booking confirmed, payment held |
| LAB-2 | ✅ Verified correct 2026-09-22 | Lab attempts to accession the sample | Real enforcement (not just documentation): accession rejects a non-collected sample (`service.go:608,626`), and result entry independently rejects unless `sm.State == SampleAccessioned` exactly (`service.go:704-706`), so a BREACHED/RECOLLECT_REQUIRED sample can never get results. Release only fires from `StateResultReady`, unreachable without passing that gate. No code change needed. |
| LAB-3 | Results released | Share results | Recipient can view; original patient identity/consent respected |
| LAB-4 | Provider payout, unverified KYC | Attempt payout | Blocked on KYC tier gate |

### healthVet ✅ (`docs/qa/modules/[none exact — see health.md]`)
**Mobile:** `app/health/vet/{index,find-vet,vet/[id],book,checkout,teleconsult-lobby,teleconsult,consult-summary,appointments,order-lab,pet-meds,eprescription/[id]}.tsx`.
**Workflow:** add/select a pet → find a vet → book (tele/home/clinic) → checkout (escrow hold) → join teleconsult → receive SOAP notes/e-prescription → view consult summary.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| VET-1 | — | Book and pay for a teleconsult | Escrow held, appointment confirmed |
| VET-2 | — | Join the teleconsult at the scheduled time | Video session starts, notes/e-prescription issued after |
| VET-3 | ✅ Fixed 2026-09-22 | Open an OLD appointment whose linked `vet_services` row was since deleted | Was a real, still-live bug (found 2026-09-15, not fixed at the time): `Appointment.ServiceID` was a plain `string`, so a NULL `service_id` (`ON DELETE SET NULL`) crashed `pgx`'s scan with "cannot scan NULL into *string" — on both `Get()` (single appointment) and `ListAppointmentsForPatient` (where it failed the WHOLE list, not just the one row). Fixed by making `ServiceID *string`, matching `EscrowID`/`ConsultID`/`DeliveryRef` on the same struct — no scan-site changes needed once the field itself is a pointer. Live-DB tests added (`internal/health/vet/null_service_id_live_db_test.go`): a hard-deleted-service appointment no longer crashes `Get()`, and a list with one NULL-service row alongside a normal one returns both. Verified the tests fail to even compile against the reverted code (via scoped `git stash`), confirming they're load-bearing. |
| VET-4 | Provider payout, unverified KYC | Attempt payout | Blocked on KYC tier gate |

### telemedicine ✅ (`docs/qa/modules/telemedicine.md`)
**Mobile:** `app/services/telemedicine/{index,doctors,doctor/[id],doctor/[id]/book,book/confirm,book/success,appointments,appointment/[id],appointment/[id]/intake,appointment/[id]/summary,appointment/[id]/review,consult/[id]}.tsx`.
**Workflow:** browse specialties/doctors → view profile → pick a slot & book → confirm/pay → complete intake → join video consult → receive prescription/summary → review.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| TELE-1 | Doctor marked available | Book a slot and pay | Appointment confirmed |
| TELE-2 | Doctor marked unavailable/inactive | Attempt to book them | Rejected — `is_available` is checked server-side, not just hidden in the UI |
| TELE-3 | ✅ Verified correct 2026-09-22 | Join the consult at appointment time | Already handled cleanly at every layer: `rtc.Issuer.Token` never fabricates a token when unconfigured, returns `ErrRTCNotConfigured` (`internal/integrations/rtc/rtc.go:62`); `doctor.issueCallToken` propagates that as `rtcConfigured=false`, empty token (`service_ops.go:40-46`); mobile's call screen has both a generic error-retry state (`call.tsx:127-130`) and an explicit Agora-failure → "Use VideoSDK" fallback banner (`call.tsx:161-163`). No code change needed. |
| TELE-4 | Consult completed | Leave a review | Review recorded once, tied to that appointment |

---

## Community

### groups 🚫 (backend only — no mobile screen found)
**Backend:** `backend/internal/groups/*`, routed at `/api/finance/groups/*`.
**Workflow (API-level only until a screen ships):** create group → list my groups → invite member (owner/admin) → member pays dues (debits wallet, credits group wallet) → view group.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| GRP-1 | — | Confirm with product/eng whether a mobile screen is planned | Until then, this module is API/contract-testable only, not mobile-UAT-able |
| GRP-2 | Plain member (not admin) | Attempt to invite another member via the API | 403 — insufficient role |
| GRP-3 | — | Pay dues without an `Idempotency-Key` | 400 |
| GRP-4 | ✅ Fixed 2026-09-22 | Pay dues, then check whether it counted against the payer's daily tier limit | Confirmed as flagged (`ledger.Debit` called with no tier gate at all) AND a second, more severe bug found investigating it: `Create()` never set `group_id` on the group's own wallet ledger account, so `PayDues`'s `WHERE group_id=$1` lookup could never find ANY group's wallet — dues payments were completely non-functional, not just ungated. Both fixed: wallet account now correctly keyed to its group; `PayDues` now calls the same `tiers.EnforceCheckoutDebitLimit` gate restaurant/transport use, refusing with `ErrTierGateUnwired` if unwired. Live-DB tests: `internal/groups/dues_live_db_test.go` (wallet findable, Tier-0 refused with zero money moved, funded member succeeds and the group wallet is actually credited, nil-gate refuses). |

### estate ✅ (`docs/qa/modules/estate.md`)
**Mobile:** `app/estate-admin/*`, `app/estate-settings/*`, `app/estate-notifications/*`. ✅ Resolved 2026-09-22 — resident screens exist, just not under `app/estate/*`: `app/property/estate.tsx` is a live "Estate & Visitor Access" sub-hub (`src/constants/modules.ts:82-84`, `roles: ['resident','guard','estate_admin']`, `phase: 'live'`), reachable from the module list, linking to Dues & Rent (`/dues`), Meetings, Elections, Facilities, Documents, Vendors, Announcements, Emergencies, AI Notes, and Reports. Not a gap — a naming-convention miss in the earlier survey.
**Workflow:** resident views a dues invoice → pays from wallet → any prior restriction lifts → resident votes in an election (if eligible) → views results when closed → vendor accepts/completes a job → requests payout.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| EST-1 | Open dues invoice | Pay an amount different from the invoice total | Rejected — "amount must equal the invoice amount" |
| EST-2 | Invoice paid | Check restriction status | Any dues-based restriction is lifted |
| EST-3 | Election not yet open / already closed | Attempt to vote | "Election is not currently open for voting" |
| EST-4 | Vendor job not yet `completed` | Vendor requests payout | Rejected until the job is marked complete |

### crowdfunding ✅ (`docs/qa/modules/crowdfunding.md`)
**Mobile:** `app/crowdfunding/{index,campaign/[id],contribute/[id],create/*,wallet/*,investment/*}.tsx`.
**Workflow:** browse/search campaigns → view one → contribute (escrowed) → track progress → campaign hits goal (creator withdraws, 90/10 split) or fails (full refund to all contributors).

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| CF-1 | — | Contribute below the 100-kobo minimum | 400, rejected |
| CF-2 | Campaign hits its goal | Creator requests withdrawal | 90/10 split applied correctly |
| CF-3 | Campaign fails to reach goal by deadline | — | All contributors refunded in full from escrow |
| CF-4 | ✅ **Re-verified fixed** — admin withdrawal-approval route | Sign in as any authenticated (non-admin) user, call `POST /admin/withdrawals/:id/approve` directly | Confirmed **live** against the running backend with a genuinely unprivileged seeded user: `GET /withdrawals`, `POST /withdrawals/:id/approve`, and `PATCH /campaigns/:id/flags` all correctly return `403 forbidden`. `internal/crowdfunding/adminext/routes.go` now gates every route with `RequirePermission(rbac, "crowdfunding.admin.review"/"crowdfunding.admin.decide")` — the code's own comment documents this exact gap being found and closed, and this session re-confirmed it live rather than trusting the comment. This flag is now stale and can be removed. |

### association ✅ (`docs/qa/modules/association.md`)
**Mobile:** `app/association/create/{basics,structure,branding,access,membership,preview,success}.tsx` (org-creation wizard); `app/association/{dues/index,pay/[invoiceId],directory,meetings/*,chat/*,ai-notes/*}.tsx`.
**Workflow:** join/apply to an association → admin approves → pay dues invoice → attend/RSVP a meeting → AI-generated minutes → admin approves/publishes notes. *(This session also added: state-leader auto-onboarding email + chapter-scoped RBAC delegation — see the association section of this session's own report for its dedicated test cases.)*

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| ASSOC-1 | — | Pay another member's dues invoice directly by id | 403 `ErrForbidden` — IDOR blocked |
| ASSOC-2 | Admin decision endpoint (e.g. approve application) | Call without `Idempotency-Key` | 400 |
| ASSOC-3 | Non-finance admin | Approve an offline dues payment | 403 |
| ASSOC-4 | State leader added with a matching platform email (this session's feature) | Publish the organisation | Leader auto-linked, granted CHAPTER_ADMIN scoped to their state, and emailed onboarding steps |
| ASSOC-5 | Same state leader | Attempt to assign `FINANCE_ADMIN`/`SUPER_ADMIN` to anyone, or assign any role to a member in a different state | Both rejected (`ErrForbidden`) |

---

## Commerce

### stays ✅ (`docs/qa/modules/stays.md`)
**Mobile:** `app/stays/{index,property/[id],book/*(occupants,lead-guest,addons,promo,payment-method,wallet-pay,review,processing,confirm,failure),trips/*(upcoming,past,cancel,modify),agent/*}.tsx`.
**Workflow:** search stays → view property → prebook (re-price, no charge) → book (hold→charge via wallet) → manage trip → cancel/modify → leave a review.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| STAY-1 | NDPA consent not yet given | Attempt to book | Blocked until consent recorded |
| STAY-2 | — | Book without an `Idempotency-Key` | 400 |
| STAY-3 | Supplier returns `BOOK_FAILED` after hold | — | Auto-release refund with **zero net debit** — verify the wallet balance nets to exactly what it was before |
| STAY-4 | Insufficient funds | Attempt to book | 402 `INSUFFICIENT_FUNDS`, nothing booked |
| STAY-5 | Booked trip | Cancel it | Partial refund/charge per policy applied correctly |

### events ✅ (`docs/qa/modules/top5events.md`)
**Mobile:** `app/events/{index,[id],checkout/tiers,checkout/review,checkout/success,my-tickets,ticket/[id]}.tsx`; cashless wallet at `app/events/wallet/*`; steward scanning at `app/events/steward/scan.tsx`.
**Workflow:** browse events → pick a ticket tier → purchase → view ticket → top up event wallet → vendor charges wallet at venue → steward scans for entry → post-event settlement.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| EVT-1 | Event not yet live, or already closed | Attempt purchase | Blocked outside the live window |
| EVT-2 | Same idempotency key resent | Retry a ticket purchase | Single debit, single ticket — no duplicate |
| EVT-3 | Ticket tier at stock capacity | Attempt one more purchase | Rejected — no oversell |
| EVT-4 | Ticket already scanned once | Scan it again at the gate | Flagged as a replay, not admitted twice |
| EVT-5 | Event wallet funded | Vendor charges more than the balance | Rejected, balance untouched |

### restaurant ✅ (`docs/qa/modules/restaurant.md`)
**Mobile:** `app/food/{index,restaurant/[id],checkout,paystack/[reference],orders/[orderId],rider/[orderId]}.tsx`.
**Workflow:** browse a restaurant → build cart → checkout (wallet or Paystack) → order escrowed → owner advances status → rider auto-dispatched on "ready" → rider enters handoff code → settlement splits 80/10/10.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| FOOD-1 | — | Checkout without an `Idempotency-Key` | 400 |
| FOOD-2 | Order at handoff | Rider enters the wrong handoff code | Rejected, order stays `picked_up`, escrow held |
| FOOD-3 | Paystack checkout path | Complete a card/transfer payment | Order only placed after webhook/poll confirms payment; a failed payment triggers server-side refund |
| FOOD-4 | ✅ Re-verified fixed 2026-09-22 | Compare `PlaceOrder`'s checks against `transport`'s | Already closed — `restaurant.placeOrder` (`internal/restaurant/service.go:816`) calls `s.tiers.EnforceCheckoutDebitLimit`, the exact same function `transport.service.go:123` calls, both against `internal/finance/tiers/checkout.go:70`. Nil-gate is refused, not treated as unlimited (`ErrTierGateUnwired`). The "wallet not active yet" message seen in earlier live testing this session comes from this same tier-0 gate, not a separate wallet-activation-only check — stale flag, doc corrected. |
| FOOD-5 | Cancel after escrow, before pickup | Cancel the order | Refund posts correctly (this session's fixed cancel-refund bug — see session notes) |

---

## Social

### socialPay ✅ (`docs/qa/modules/social.md`)
**Mobile:** `app/social/{index,cashtag-setup,send,request,split/create,pool/create}.tsx`.
**Workflow:** claim a cashtag → send/request money or create a split/pool → recipient pays → funds move wallet-to-wallet via an escrow standing account.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| SOC-1 | No cashtag claimed yet | Attempt to send/request | Blocked until a cashtag is claimed |
| SOC-2 | — | Send above the ₦200,000 single-send cap | `ErrAMLSingleLimit` |
| SOC-3 | Already at daily AML count/amount cap | Send one more, of any size | `ErrAMLCountLimit` / `ErrAMLAmountLimit` |
| SOC-4 | ✅ Verified correct 2026-09-22 | Attempt a send during the outage | Already fail-closed: `AML.Check` (`internal/social/aml.go:55-57`) wraps any DB error and returns it, blocking the send; every money-moving path in `social/service.go` (Send + 3 others) calls it first, unconditionally; `aml` is never nil at wiring (`top5_p1_routes.go:107`). No code change needed. |
| SOC-5 | Split created by another user | Attempt to pay a share/request that isn't yours | Blocked — IDOR check |

---

## Mobility

### transport ✅ (`docs/qa/modules/transport.md`)
**Mobile:** `app/mobility/*` — RequestRide flow.
**Workflow:** request a ride (fare quoted) → fare escrowed (fail-closed KYC/tier gate) → driver accepts → trip runs through its state machine → completion releases escrow with the commission split; cancellation refunds escrow.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| TRN-1 | Tier 0 or over-limit account | Request a ride | Blocked fail-closed at the fare-escrow step |
| TRN-2 | Ride requested, driver accepts, trip completes | — | Escrow releases with the correct commission split |
| TRN-3 | Ride cancelled after escrow, before completion | — | Escrow refunds correctly |
| TRN-4 | ✅ Verified correct 2026-09-22 | Confirm no `MockMaps` fake-fare provider is wired | Guarded, though not as a boot-time crash — `mockPolicy.ts`'s `isMocklessEnvironment()` hard-forces `mockAllowed(...)` to `false` in staging/production regardless of `EXPO_PUBLIC_MOBILITY_USE_MOCK` (`mobility.api.ts:61`), so mobility's mock fare/estimate functions can never be wired in a deployed environment — same safety property (no invented fare data reaches a real customer), enforced centrally rather than per-module. No code change needed. |

---

## Property

### realtor ✅ (`docs/qa/modules/realtor.md`, `property.md`, `property-management-supplement.md`)
**Mobile:** `app/realtor/{search/index,listing/[id]/index,inspection/book,apply/index,lease/[id]/sign,lease/[id]/pay,lease/[id]/move-in,shortlet/[id]/book,owner/*,ai/listing-assistant}.tsx`.
**Note:** the Go backend here is **admin-control-plane only** (moderation/verification/escrow under `realtor.manage` RBAC); the member data plane (listings, leases, payments) runs through Supabase RPCs via a Next.js proxy that mobile calls directly.
**Workflow:** search listings → view one → book an inspection → apply → sign lease → pay → move in (or book a shortlet directly).

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| RLT-1 | Lease ready to pay | Pay the invoice | A real ledger DEBIT must be posted before the lease finalizes — verify this, since it was previously possible to finalize with **zero verified debit** (now fixed; confirm it stays fixed) |
| RLT-2 | Payment method = Paystack (per the fix) | Attempt to pay | Should return 501 (not implemented) rather than silently faking success |
| RLT-3 | — | Book an inspection and complete the apply flow | Application status visible to the applicant and to the owner |
| RLT-4 | Non-`realtor.manage` account | Attempt to hit an admin moderation/verification endpoint directly | 403 |

---

## Ops

### aiCare ✅ (`docs/qa/modules/aicare.md`)
**Mobile:** ⚠️ **`app/services/support.tsx` is a local-only static contact form — it does not call the aiCare backend at all.** The real backend (`/api/finance/support/sessions...`, Claude-backed) appears to have no connected mobile screen.
**Workflow (backend-only until wired):** create a support session → send messages → AI replies → escalate to a human agent → agent resolves.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| AIC-1 | 🚫 **Needs a product decision — not resolvable in this pass** | Confirm with product whether `app/services/support.tsx` is meant to call aiCare, or aiCare is meant for a different surface | Re-checked 2026-09-22: `app/services/support.tsx` (151 lines) is still genuinely static — zero network calls, zero query/mutation wiring, a plain contact form. The real aiCare backend (`/api/finance/support/sessions...`, Claude-backed, AIC-2's IDOR already fixed this session) has no connected mobile screen at all. This is a real product/design choice, not a bug with an obvious fix: connecting `support.tsx` to aiCare, building a new dedicated chat screen, or leaving aiCare backend-only for now are all legitimate directions depending on product intent — none of which this pass should decide unilaterally. Left open, flagged for a human decision. |
| AIC-2 | ✅ **Fixed 2026-09-19** | User A creates a session; User B calls `resolve` on User A's session id | Was NOT owner-scoped (`Resolve` took an `actorID` param but never used it in the `WHERE` clause — any authenticated user could close any other user's session). Fixed: query now scopes `AND user_id=$2` and fails closed (404-style error) instead of silently no-op-ing; live-DB regression test added (`internal/aicare/resolve_idor_live_db_test.go`) proving a non-owner is rejected and the session is left untouched. |
| AIC-3 | Escalated session | Human agent takes over | Agent sees full conversation history before replying |

### disputes ✅ (`docs/qa/modules/disputes.md`)
**Mobile:** 🚫 no standalone "Disputes" screen — embedded per-flow (`app/stays/support/dispute.tsx`, `app/(doctor)/support/disputes/*`, `mobility/movers/[id].tsx`), several of which are local/mock rather than calling the generic dispute API.
**Workflow:** raise a dispute from within the relevant order/booking flow → admin reviews → resolves (refund where applicable).

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| DIS-1 | Food order dispute | Admin resolves with a refund | Real refund posted (this is the one module_type with wired refund logic) |
| DIS-2 | ✅ Confirmed + UI fixed 2026-09-22 | Admin marks it "resolved: refunded" | Confirmed: `disputes.Service.Resolve` (`internal/finance/disputes/service.go:101-133`) only moves real money for `module_type=="food"` (via the injected `FoodDisputeResolver`) — every other type is a bare status update, by deliberate, documented design (no refund engine built yet for stays/mobility/etc; no non-food dispute exists in the table today per `finance_routes.go:2501-2502`). Not a backend bug to fix here — building a refund engine for every module is out of scope for this pass. But the admin console offered "Full refund"/"Partial refund" with zero indication this wouldn't move money for a non-food dispute — fixed with an inline warning in `frontend-admin/app/admin/finance/disputes/page.tsx` shown whenever a non-food dispute's resolution is set to a refund option, verified live in the browser (mocked a "stays" dispute, confirmed the warning renders on selecting "Full refund" and disappears on "No action"). `tsc --noEmit` clean. |
| DIS-3 | ✅ Verified correct, no regression 2026-09-22 | Any authenticated user attempts to resolve/refund their own dispute | Still gated: `POST /api/finance/admin/disputes/:id/resolve` requires `RequirePermission(rbac, "restaurant.admin.disputes")` (`finance_routes.go:2505`, fail-closed middleware — `err != nil \|\| !allowed` → 403). The handler that once had no gate (`AdminResolveFoodDispute`) is not even registered as its own route any more; the only live path to this action is the RBAC-gated generic route. No other dispute-resolve route exists to bypass it. No code change needed. |

### ratings ✅ (`docs/qa/modules/ratings.md`)
**Mobile:** embedded post-transaction — `app/health/vet/ratings.tsx`, `health/pharmacy/ratings.tsx`, `health/lab/ratings.tsx`, `mobility/bus/review.tsx`, `services/telemedicine/appointment/[id]/review.tsx`.
**Workflow:** complete a transaction (consult, ride, order, etc.) → prompted to rate → submit 1–5 score → tied to that transaction.

| # | Precondition | Steps | Expected result |
|---|---|---|---|
| RAT-1 | Completed transaction | Submit a rating of 1–5 | Recorded, tied to `transaction_ref` |
| RAT-2 | — | Submit a score outside 1–5 | Validation error |
| RAT-3 | ✅ Fixed 2026-09-22 | Already rated this transaction | Was worse than a silent no-op: `Create()` returned a FABRICATED `Rating` on conflict — a fresh random id, the REJECTED second request's own score/comment, and `time.Now()` — so if the second submission's score differed from the first, the response actively lied about what was stored. Fixed: `Create` now returns `(rating, created bool, err)`; on conflict it fetches and returns the row that actually exists, and the handler returns `200` (not `201`) instead of a fabricated `201`. Live-DB test added (`internal/finance/ratings/duplicate_live_db_test.go`) proving the second response's id/score/created_at all match the real first row, not the rejected second request. No mobile screen currently calls this generic `/api/finance/ratings` endpoint, so the UI-messaging half of this flag doesn't apply yet — the backend-level fabrication was the real bug. |

---

## Notes on how this document was produced

Facts above (mobile screen paths, workflows, error codes, and the ⚠️ gaps)
were gathered by reading the actual mobile route tree and backend
service/handler code for each module, not inferred from module names.
Anywhere marked 🚫 or ⚠️, that's a genuine finding worth a human looking at —
either a missing mobile surface, a security/consistency gap, or a fixed bug
worth a regression case — not a placeholder. Cross-check against
`docs/qa/modules/<slug>.md` before executing a case, since those files may
have been updated more recently than this one.
