# QA Defect Report — Paymax Mobile Bills Payments
**Audit date:** 2026-06-14  
**Auditor role:** Senior QA Engineer / React Native Playwright Specialist  
**Scope:** `mobile-app/reactnative/` — all Playwright E2E specs and billing screen implementations

---

## Technical File Map

| Category | Files |
|---|---|
| Playwright config | `playwright.config.ts` — Expo web (port 8083), mobile-chrome (390×844) + desktop-chrome (1280×900), 45s timeout |
| Spec files | `tests/e2e/bills/airtime.spec.ts`, `cable-tv.spec.ts`, `data.spec.ts`, `electricity-prepaid.spec.ts`, `electricity-postpaid.spec.ts`, `provider-failover.spec.ts`, `security.spec.ts`, `transaction-history.spec.ts`, `validation.spec.ts`, `wallet-ledger.spec.ts` |
| New spec files | `tests/e2e/auth/login.spec.ts`, `tests/e2e/bills/retry-polling.spec.ts` |
| Helpers | `tests/e2e/helpers/{auth,wallet,bills,assertions,testData}.ts` |
| Fixtures | `tests/e2e/fixtures/{users,billers,providerResponses}.ts` |
| Screen implementations | `app/services/{airtime,data,electricity,cable-tv,bills}.tsx`, `app/services/receipt/[id].tsx`, `app/services/transactions/{index,[id]}.tsx` |
| Supporting | `src/components/PrimaryButton.tsx`, `src/api/billing.api.ts`, `src/utils/errorMapper.ts`, `src/utils/idempotency.ts` |

---

## Screen Inventory

| Screen | Route | Status |
|---|---|---|
| Bills Hub | `/services/bills` | ✅ Implemented |
| Airtime | `/services/airtime` | ✅ Implemented |
| Data | `/services/data` | ✅ Implemented |
| Electricity | `/services/electricity` | ✅ Implemented |
| Cable TV | `/services/cable-tv` | ✅ Implemented |
| Receipt | `/services/receipt/[id]` | ✅ Implemented |
| Transaction List | `/services/transactions` | ✅ Implemented |
| Transaction Detail | `/services/transactions/[id]` | ✅ Implemented |
| Login | `/(auth)/login` | ✅ Implemented |
| OTP Verify | `/(auth)/verify-otp` | ✅ Implemented |
| Forgot Password | `/(auth)/forgot-password` | ✅ Implemented |
| Transaction PIN authorization | In payment review modals | ✅ Implemented |
| Saved Beneficiaries | `/services/beneficiaries` | ✅ Basic management screen implemented |
| Education Payment | `/services/education` | ⚠️ Route registered, screen exists but not wired to real API |

---

## Defect Register

### QA-001 — CRITICAL: Transaction PIN not required before wallet debit

**Status:** Fixed  
**Affected specs:** `security.spec.ts`  
**Severity:** Critical — security/financial  
**Description:** Bills payment flows debit the wallet via "Confirm & Pay" with no PIN or biometric step. A stolen device/session can drain the wallet with one tap.  
**Expected:** Confirmation modal shows a 4–6 digit PIN field; wrong PIN prevents payment; 3 wrong attempts locks PIN for cooldown period.  
**Actual after fix:** Confirmation modals now require a 4-digit transaction PIN before dispatching any `purchase*` or `pay*` mutation. Payloads include `transactionPin`.
**Remaining backend requirement:** Server must validate PIN, enforce retry limits, and lock/cooldown policy.

---

### QA-002 — HIGH: Ambiguous `getByText('Airtime')` selector in transaction-history.spec.ts

**Affected specs:** `transaction-history.spec.ts` (original line: `await page.getByText('Airtime').click()`)  
**Severity:** High — test reliability  
**Description:** The transactions page renders both filter pills ("All", "Airtime", "Data"…) and transaction card titles (productName = "Airtime" for airtime transactions). `page.getByText('Airtime').click()` throws Playwright strict-mode error: "locator resolved to N elements."  
**Root cause:** Test uses ambiguous locator where multiple DOM elements share identical text.  
**Fix applied:** Replaced with direct navigation to transaction detail URL and separate pill-click test; added `.first()` guards. See updated `tests/e2e/bills/transaction-history.spec.ts`.

---

### QA-003 — HIGH: "VTPASS" provider name rendered in Bills Hub UI

**Status:** Fixed  
**Affected files:** `app/services/bills.tsx` line 49  
**Severity:** High — compliance / brand leakage  
**Description:** Provider-branded text was exposed in customer-facing bills UI.  
**Business rule:** The mobile app must not expose VTPass, Reloadly, Baxi, BuyPower or any third-party provider name to users.  
**Fix applied:** Replaced provider-specific public-facing language with neutral secure-service/failover language.  
**Note:** Customer-facing screens should continue to use neutral provider-routing language.

---

### QA-004 — MEDIUM: Prepaid electricity token delivery race condition not guarded on client

**Status:** Fixed  
**Affected specs:** `provider-failover.spec.ts`  
**Severity:** Medium  
**Description:** If the backend returns `status: PENDING` with no token for a prepaid electricity transaction, the receipt screen renders whatever the API returns without any client-side guard. A user sees "Payment Successful" with no token box — they have paid but cannot use their electricity.  
**Expected:** Receipt screen for PREPAID electricity with no `token` field should show a warning: "Token pending — check back in 5 minutes" and auto-poll.  
**Actual after fix:** Receipt now shows a missing-token support message for prepaid electricity with no token, and review warns that delayed token delivery remains pending for automatic requery.

---

### QA-005 — MEDIUM: Bills Hub shows hardcoded "Recent Billers" instead of live API data

**Affected files:** `app/services/bills.tsx`, `src/data/billPayment.ts`  
**Severity:** Medium — data accuracy  
**Description:** The "Recent Billers" section renders `RECENT_BILLERS` (hardcoded: EKEDC/MTN/DSTV with fabricated amounts). Real users will always see these dummy entries regardless of their actual history.  
**Fix required:** Fetch recent transactions from the API (`getTransactions({ limit: 3 })`) and display actual history, or remove the section entirely.

---

### QA-006 — LOW: `completeElectricityPayment` helper asserts `₦10,000` but amount pills only show after meter validation

**Affected specs:** `electricity-postpaid.spec.ts` (via `completeElectricityPayment` helper)  
**Severity:** Low — currently works because `validateElectricityMeter` is called first  
**Description:** Amount pills (₦1,000 – ₦20,000) are conditionally rendered: `{validation && (<View>...amountGrid...</View>)}`. The helper calls `validateElectricityMeter` first, so the section is visible when `page.getByText('₦10,000').click()` is invoked. If the order changes, the test will fail without a clear error.  
**Fix:** No immediate action required; document the dependency in the helper function.

---

### QA-007 — LOW: No test for OTP verification flow

**Gap, not a bug.**  
**Description:** The `verify-otp.tsx` screen (6-box OTP input with auto-advance and resend) has no E2E coverage.  
**Fix required:** Add spec under `tests/e2e/auth/` covering: correct OTP navigates to home; wrong OTP shows error; resend OTP sends request.

---

### QA-008 — LOW: `education.tsx` route registered but screen is not wired to real API

**Affected files:** `app/services/_layout.tsx`, `src/data/billPayment.ts`  
**Severity:** Low — not yet in test scope  
**Description:** The education service tile appears in the bills hub and a screen file likely exists, but there is no `educationApi.ts` or equivalent. Clicking "Education" navigates to a stub/static screen.  
**Fix required:** Either implement the education API bindings (following the same pattern as other services) or disable the tile with a feature flag.

---

## Known Defect Summary (pre-existing, test.fail markers)

| ID | Description | Spec |
|---|---|---|
| KD-01 | PIN retry / lockout must be enforced by backend PIN verification | `security.spec.ts` |
| KD-02 | Native background/offline/device-keyboard scenarios require Detox/Maestro/Appium | Not covered by Playwright |

---

## Test Coverage Summary (post-audit)

| Workflow | Coverage | Notes |
|---|---|---|
| A: Airtime purchase | ✅ Full | Happy path + payload + idempotency key |
| B: Data purchase | ✅ Full | Happy path + empty plan state |
| C: Electricity prepaid | ✅ Full | Validation gate + token on receipt |
| D: Electricity postpaid | ✅ Full | No-token assertion |
| E: Cable TV | ✅ Full | Smart card validation + empty package state |
| Provider failover | ✅ Partial | Timeout error surface tested; review/receipt expose provider-routing visibility |
| Wallet / financial | ✅ Full | Insufficient balance (402) + double-submit prevention |
| Security | ✅ Partial | API key exposure and PIN gate tested; backend retry/lockout still required |
| UX error states | ✅ Full | Phone validation, networks load failure, meter lookup failure |
| Transaction history | ✅ Fixed | Ambiguous selector fixed; detail + navigation covered |
| Auth flow | ✅ New | Login success/failure, 401 redirect, session persistence |
| Retry / polling | ✅ New | FAILED→retry, PENDING/PROCESSING notice, timeout error |

---

## Test Data Requirements

All test data is fully mocked via `page.route()` interceptors. No backend seeding is required for E2E runs. To run against a real staging backend, set `E2E_BASE_URL=https://staging.api.paymax.ng` and remove or bypass the mock routes in `beforeEach`.

Fixture reference: `tests/e2e/fixtures/{users,billers,providerResponses}.ts`

| Fixture | Key values |
|---|---|
| `users.funded` | walletBalance: 150,000 kobo (₦1,500) |
| `users.unfunded` | walletBalance: 25 kobo (₦0.25) |
| Valid phone | `08031234567` |
| Valid meter | `123456789012` |
| Valid smartcard | `1234567890` |
| Airtime receipt ref | `PMX-AIRTIME-001` |
| Prepaid token | `1234-5678-9012-3456` |
