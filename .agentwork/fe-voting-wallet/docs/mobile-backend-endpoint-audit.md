# Mobile ↔ Backend Endpoint Integration Audit

**Generated:** 2026-06-15  
**Repo root:** `/Users/paymax/Desktop/wordpress/spotlight/new`  
**Mobile app:** `apps/mobile-starter/` (Expo Router, React Native)  
**Backend:** `frontend-web/app/api/` (Next.js API routes) + `backend/` (Go/Gin)

---

## 1. Executive Summary

**Biggest risks (P0):**

1. **ALL billing/VAS endpoints are mismatched.** The mobile `billing.api.ts` calls paths under `/services/*` (e.g. `/services/airtime/networks`, `/services/data/plans`, `/services/electricity/discos`, `/services/cable/providers`). None of these paths exist anywhere in the backend. The real utility endpoints live under `/api/v1/utility/*` with a completely different API contract (generic biller/product model vs per-service dedicated routes). Every bill-payment screen (Airtime, Data, Electricity, Cable) is **completely broken** in production.

2. **Auth endpoints are misrouted.** The mobile calls `/auth/login`, `/auth/register`, `/auth/me` etc. (relative to `EXPO_PUBLIC_API_BASE_URL = https://api.yourdomain.com/api/v1`), which resolves to `/api/v1/auth/*`. The Go backend exposes auth at `/api/auth/*` (no `/v1/` prefix). The Next.js API layer has no `/auth/*` proxy routes. **Login and registration do not work.**

3. **Wallet endpoints are mismatched.** The mobile calls `/wallet`, `/wallet/transactions`, `/wallet/fund/initiate`, `/wallet/fund/verify`. The backend exposes these at `/api/v1/wallet/balance`, `/api/v1/wallet/transactions`, `/api/v1/wallet/topup`. Path names and request/response schemas differ.

4. **Dashboard and Transactions endpoints do not exist.** The mobile calls `/dashboard` and `/transactions/*`. No such routes exist in either backend layer.

5. **`/api/v2/votes/paid/initiate` does not exist.** The mobile calls this path for paid votes, but only `/api/votes/paid/initiate` (no `v2`) exists. Every paid vote attempt will 404.

6. **Contest Registration screen submits nothing.** `register.tsx` uses a `setTimeout(() => alert(...), 1500)` — no API call is made.

**P0 count: 6 critical blockers**  
**P1 count: 4 important gaps**  
**P2 count: 5 moderate gaps**  
**P3 count: 3 minor issues**

---

## 2. Backend Endpoint Inventory

### 2a. Next.js API Routes (frontend-web/app/api/)

The mobile app's `EXPO_PUBLIC_API_BASE_URL` is set to the domain root or a `/api/v1` prefix. Routes that the mobile can realistically reach are listed below.

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/v1/contests` | No | Supports `?category=&search=` |
| GET | `/api/v1/contests/categories` | No | Returns `[{id, name, activeContestCount}]` |
| GET | `/api/v1/contests/:id` | Optional | Returns ContestDetail incl. `freeVotesRemaining` |
| GET | `/api/v1/contests/:id/contestants` | No | Supports `?search=` |
| GET | `/api/v1/contestants/:id` | No | Returns ContestantDetail incl. `contestId` |
| GET | `/api/v1/contests/:id/leaderboard` | No | Returns ranked LeaderboardEntry[] |
| GET | `/api/v1/contests/:id/vote-packages` | No | Returns VotePackage[] |
| POST | `/api/v2/votes/free` | Optional | Body: `{contestId, contestantId, idempotencyKey}`. Requires `X-Idempotency-Key` header |
| POST | `/api/v2/votes/paid/verify` | Required | Body: `{transactionId, paymentReference}` |
| GET | `/api/votes/remaining` | Optional | Query: `?contestId=` |
| POST | `/api/votes/paid/initiate` | Optional | **NOT `/api/v2/votes/paid/initiate`** |
| GET | `/api/v1/wallet/balance` | Required (KYC T1) | Returns `{available_kobo, currency, account_id}` |
| POST | `/api/v1/wallet/topup` | Required (KYC T1) | Body: `{amount_kobo}`. Requires `Idempotency-Key` header |
| GET | `/api/v1/wallet/transactions` | Required (KYC T1) | Returns `{transactions, meta}` |
| GET | `/api/v1/utility/categories` | Required | Returns `{categories}` |
| GET | `/api/v1/utility/billers` | Required | Query: `?category=` |
| GET | `/api/v1/utility/products` | Required | Query: `?category=&biller=` |
| POST | `/api/v1/utility/validate` | Required | Body: `{category, biller_id, customer_reference}` |
| POST | `/api/v1/utility/pay` | Required (KYC) | Body: `{category, biller_id, product_id, customer_reference, amount_kobo}`. Requires `Idempotency-Key` |
| GET | `/api/v1/utility/transactions` | Required | Returns paginated list |
| GET | `/api/v1/utility/transactions/:id` | Required | Single transaction |
| GET | `/api/v1/utility/transactions/:id/receipt` | Required | Receipt |
| POST | `/api/v1/utility/transactions/:id/requery` | Required | Requery status |
| GET | `/api/v1/utility/beneficiaries` | Required | Saved beneficiaries |
| GET | `/api/v1/kyc/me` | Required | KYC status |
| POST | `/api/v1/kyc/initiate` | Required | Initiate KYC |
| GET | `/api/v1/virtual-accounts/me` | Required | Virtual account details |
| GET | `/api/me` | Required | User profile |
| GET | `/api/me/profile` | Required | Extended profile |
| POST | `/api/me/profile` | Required | Update profile |
| GET | `/api/me/applications` | Required | User contest applications |

> **Note:** There are no Next.js routes at `/api/auth/*`, `/dashboard`, `/transactions/*`, `/wallet` (root), `/wallet/fund/*`, or `/services/*`.

### 2b. Go Backend Routes (backend/)

The Go backend serves on a separate port and is **not proxied** to the mobile. It handles admin, auth, RBAC, STEM, and competition management:

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/register` | No | Go auth handler |
| POST | `/api/auth/login` | No | Go auth handler |
| POST | `/api/auth/logout` | Bearer | |
| POST | `/api/auth/request-password-reset` | No | Note: path differs from mobile's `forgot-password` |
| POST | `/api/auth/reset-password` | No | |
| GET | `/api/auth/verify-email` | No | |
| POST | `/api/auth/resend-verification-link` | No | Note: path differs from mobile's `resend-otp` |
| GET | `/api/auth/me` | Bearer | |
| POST | `/api/auth/change-password` | Bearer | |
| GET | `/api/v1/public/health` | No | |
| Various | `/api/v1/admin/*` | Admin Key | Admin panel only |
| Various | `/api/admin/*` | Bearer + RBAC | RBAC admin only |
| Various | `/api/v1/schools/*` | No | STEM |
| Various | `/api/v1/stem-*` | Varies | STEM |

---

## 3. Mobile Screen Inventory

| Screen File | Route | API Functions Called | Notes |
|-------------|-------|----------------------|-------|
| `app/index.tsx` | `/` | None | Redirect to auth or protected |
| `app/(auth)/login.tsx` | `/login` | `authApi.login` via store | Calls `POST /auth/login` |
| `app/(auth)/register.tsx` | `/register` | `authApi.register` via store | Calls `POST /auth/register` |
| `app/(auth)/forgot-password.tsx` | `/forgot-password` | `forgotPassword` | Calls `POST /auth/forgot-password` |
| `app/(auth)/verify-otp.tsx` | `/verify-otp` | `verifyOtp`, `resendOtp` | Calls `POST /auth/verify-otp`, `POST /auth/resend-otp` |
| `app/(protected)/(tabs)/index.tsx` | `/(tabs)/` | `getDashboard` | Calls `GET /dashboard` |
| `app/(protected)/(tabs)/wallet.tsx` | `/(tabs)/wallet` | `getWallet`, `getWalletTransactions`, `initiateWalletFunding` | Calls `/wallet`, `/wallet/transactions`, `/wallet/fund/initiate` |
| `app/(protected)/(tabs)/vote.tsx` | `/(tabs)/vote` | `fetchContests`, `fetchCategories` | Calls `/api/v1/contests`, `/api/v1/contests/categories` |
| `app/(protected)/(tabs)/pay.tsx` | `/(tabs)/pay` | None | Navigation only |
| `app/(protected)/(tabs)/invest.tsx` | `/(tabs)/invest` | None | Static placeholder |
| `app/(protected)/(tabs)/more.tsx` | `/(tabs)/more` | `getMe` | Calls `GET /auth/me` |
| `app/(protected)/airtime.tsx` | `/airtime` | `getAirtimeNetworks`, `buyAirtime` | Calls `/services/airtime/networks`, `/services/airtime/purchase` |
| `app/(protected)/data.tsx` | `/data` | `getDataNetworks`, `getDataPlans`, `buyData` | Calls `/services/data/networks`, `/services/data/plans`, `/services/data/purchase` |
| `app/(protected)/electricity.tsx` | `/electricity` | `getElectricityDiscos`, `validateMeter`, `payElectricity` | Calls `/services/electricity/discos`, `/services/electricity/validate`, `/services/electricity/pay` |
| `app/(protected)/cable.tsx` | `/cable` | `getCableProviders`, `getCablePackages`, `validateCable`, `payCable` | Calls `/services/cable/providers`, `/services/cable/packages`, `/services/cable/validate`, `/services/cable/pay` |
| `app/(protected)/contest/[id].tsx` | `/contest/:id` | `fetchContestDetail` | Calls `/api/v1/contests/:id` |
| `app/(protected)/contest/[id]/contestants.tsx` | `/contest/:id/contestants` | `fetchContestants` | Calls `/api/v1/contests/:id/contestants` |
| `app/(protected)/contest/[id]/leaderboard.tsx` | `/contest/:id/leaderboard` | `fetchLeaderboard` | Calls `/api/v1/contests/:id/leaderboard`, polls every 30s |
| `app/(protected)/contest/buy-votes.tsx` | `/contest/buy-votes` | `fetchVotePackages` | Calls `/api/v1/contests/:id/vote-packages` |
| `app/(protected)/contest/vote-modal.tsx` | `/contest/vote-modal` | `fetchVotePackages` | Calls `/api/v1/contests/:id/vote-packages` |
| `app/(protected)/contest/payment-method.tsx` | `/contest/payment-method` | `initiatePaidVote` | Calls `POST /api/v2/votes/paid/initiate` — **DOES NOT EXIST** |
| `app/(protected)/contest/register.tsx` | `/contest/register` | **None** | Uses `setTimeout` fake submit — **no API call** |
| `app/(protected)/contest/vote-success.tsx` | `/contest/vote-success` | None | Display only — gets data from route params |
| `app/(protected)/contestant/[id].tsx` | `/contestant/:id` | `fetchContestantDetail`, `fetchRemainingFreeVotes`, `castFreeVote` | Calls `/api/v1/contestants/:id`, `/api/votes/remaining`, `POST /api/v2/votes/free` |
| `app/(protected)/transactions/index.tsx` | `/transactions` | `getTransactions` | Calls `GET /transactions` — **DOES NOT EXIST** |
| `app/(protected)/transactions/[id].tsx` | `/transactions/:id` | `getTransaction`, `retryTransaction` | Calls `GET /transactions/:id`, `POST /transactions/:id/retry` — **DO NOT EXIST** |
| `app/(protected)/receipt/[id].tsx` | `/receipt/:id` | `getReceipt` | Calls `GET /transactions/:id/receipt` — **DOES NOT EXIST** |

---

## 4. Frontend API Service Inventory

| Service File | Functions | Target Paths | Status |
|--------------|-----------|--------------|--------|
| `src/api/auth.api.ts` | `login`, `register`, `verifyOtp`, `resendOtp`, `forgotPassword`, `resetPassword`, `getMe`, `logout` | `/auth/*` (relative) | **BROKEN** — paths resolve wrong |
| `src/api/billing.api.ts` | `getAirtimeNetworks`, `buyAirtime`, `getDataNetworks`, `getDataPlans`, `buyData`, `getElectricityDiscos`, `validateMeter`, `payElectricity`, `getCableProviders`, `getCablePackages`, `validateCable`, `payCable` | `/services/*` | **ALL BROKEN** — no such routes exist |
| `src/api/wallet.api.ts` | `getWallet`, `getWalletTransactions`, `initiateWalletFunding`, `verifyWalletFunding` | `/wallet`, `/wallet/transactions`, `/wallet/fund/*` | **BROKEN** — wrong paths |
| `src/api/transactions.api.ts` | `getTransactions`, `getTransaction`, `getReceipt`, `retryTransaction` | `/transactions/*` | **BROKEN** — no such routes exist |
| `src/api/dashboard.api.ts` | `getDashboard` | `/dashboard` | **BROKEN** — no such route |
| `src/api/voting.api.ts` | `fetchCategories`, `fetchContests`, `fetchContestDetail`, `fetchContestants`, `fetchContestantDetail`, `fetchLeaderboard`, `fetchRemainingFreeVotes`, `castFreeVote`, `fetchVotePackages`, `initiatePaidVote`, `verifyPaidVote` | `/api/v1/contests/*`, `/api/v2/votes/*`, `/api/votes/remaining` | **MOSTLY WORKING** except `initiatePaidVote` calls wrong path |
| `src/services/api/client.ts` | Re-exports `api` as `apiClient` | — | Thin re-export, not directly used by screens |

---

## 5. Endpoint-to-Screen Mapping Matrix

| Backend Endpoint | Mobile Screen | API Function | Status |
|------------------|---------------|--------------|--------|
| `GET /api/v1/contests` | `vote.tsx` | `fetchContests` | ✅ Connected |
| `GET /api/v1/contests/categories` | `vote.tsx` | `fetchCategories` | ✅ Connected |
| `GET /api/v1/contests/:id` | `contest/[id].tsx` | `fetchContestDetail` | ✅ Connected |
| `GET /api/v1/contests/:id/contestants` | `contest/[id]/contestants.tsx` | `fetchContestants` | ✅ Connected |
| `GET /api/v1/contestants/:id` | `contestant/[id].tsx` | `fetchContestantDetail` | ✅ Connected |
| `GET /api/v1/contests/:id/leaderboard` | `contest/[id]/leaderboard.tsx` | `fetchLeaderboard` | ✅ Connected |
| `GET /api/v1/contests/:id/vote-packages` | `buy-votes.tsx`, `vote-modal.tsx` | `fetchVotePackages` | ✅ Connected |
| `POST /api/v2/votes/free` | `contestant/[id].tsx` | `castFreeVote` | ✅ Connected |
| `GET /api/votes/remaining` | `contestant/[id].tsx` | `fetchRemainingFreeVotes` | ✅ Connected |
| `POST /api/v2/votes/paid/verify` | Not wired to any screen | `verifyPaidVote` | ⚠️ Function exists, no screen calls it |
| `POST /api/votes/paid/initiate` (actual) | `payment-method.tsx` | `initiatePaidVote` | ❌ Mobile calls `/api/v2/votes/paid/initiate` (wrong path) |
| `GET /api/v1/wallet/balance` | `wallet.tsx` | `getWallet` | ❌ Mobile calls `/wallet` |
| `GET /api/v1/wallet/transactions` | `wallet.tsx` | `getWalletTransactions` | ❌ Mobile calls `/wallet/transactions` |
| `POST /api/v1/wallet/topup` | `wallet.tsx` | `initiateWalletFunding` | ❌ Mobile calls `/wallet/fund/initiate` |
| `GET /api/v1/utility/categories` | — | — | ❌ No screen uses utility API |
| `GET /api/v1/utility/billers` | — | — | ❌ No screen uses utility API |
| `GET /api/v1/utility/products` | — | — | ❌ No screen uses utility API |
| `POST /api/v1/utility/validate` | `electricity.tsx`, `cable.tsx` | `validateMeter`, `validateCable` | ❌ Mobile calls `/services/*` |
| `POST /api/v1/utility/pay` | `airtime.tsx`, `data.tsx`, `electricity.tsx`, `cable.tsx` | `buyAirtime`, `buyData`, etc. | ❌ Mobile calls `/services/*` |
| `GET /api/v1/utility/transactions` | — | — | ❌ No mobile screen uses this |
| `GET /api/v1/utility/transactions/:id` | — | — | ❌ No mobile screen uses this |
| `GET /api/v1/utility/transactions/:id/receipt` | — | — | ❌ No mobile screen uses this |
| N/A | `(tabs)/index.tsx` | `getDashboard` | ❌ No `/dashboard` route exists |
| N/A | `transactions/index.tsx` | `getTransactions` | ❌ No `/transactions` route exists |
| N/A | `transactions/[id].tsx` | `getTransaction`, `retryTransaction` | ❌ No `/transactions/:id` routes exist |
| N/A | `receipt/[id].tsx` | `getReceipt` | ❌ No `/transactions/:id/receipt` route for mobile |
| `POST /api/auth/register` (Go) | `register.tsx` | `authApi.register` | ❌ URL base mismatch + path mismatch |
| `POST /api/auth/login` (Go) | `login.tsx` | `authApi.login` | ❌ URL base mismatch + path mismatch |
| `GET /api/auth/me` (Go) | `more.tsx` | `getMe` | ❌ URL base mismatch + path mismatch |

---

## 6. Critical Integration Gaps

### Gap 1 — Auth Endpoint URL Mismatch (P0)

**Module:** Authentication  
**Affected Screens:** `login.tsx`, `register.tsx`, `forgot-password.tsx`, `verify-otp.tsx`, `more.tsx`  
**Complexity:** Medium  
**Business Risk:** App is completely unusable — no user can log in

**Root Cause:**  
`EXPO_PUBLIC_API_BASE_URL=https://api.yourdomain.com/api/v1`

The mobile calls paths like `/auth/login`, which resolves to `https://api.yourdomain.com/api/v1/auth/login`. The Go backend registers routes at `/api/auth/login` (no `/v1` prefix), served on a different base URL entirely.

Additionally, specific path mismatches exist:
- Mobile calls `POST /auth/forgot-password` → Go backend has `POST /api/auth/request-password-reset`
- Mobile calls `POST /auth/verify-otp` → Go backend has `GET /api/auth/verify-email` (different method + path)
- Mobile calls `POST /auth/resend-otp` → Go backend has `POST /api/auth/resend-verification-link`

**Fix required:**
1. Decide on the canonical auth server (Go backend or Next.js API routes).
2. Either: add Next.js auth proxy routes at `frontend-web/app/api/auth/*/route.ts`, or
3. Change `EXPO_PUBLIC_API_BASE_URL` to point directly to the Go backend and align all path names.
4. Create a mapping in `billing.api.ts` from mobile path names to actual endpoint paths.

---

### Gap 2 — Billing Service Path Mismatch (P0)

**Module:** Bills & VAS  
**Affected Screens:** `airtime.tsx`, `data.tsx`, `electricity.tsx`, `cable.tsx`  
**Complexity:** High  
**Business Risk:** All bill payment revenue blocked — primary monetization feature broken

**Root Cause:**  
`billing.api.ts` calls `/services/airtime/networks`, `/services/data/networks`, etc. (12 different URLs). These paths do not exist anywhere in the codebase.

The real billing API (`/api/v1/utility/*`) uses a **generic biller/product model**, not per-service dedicated routes:
- There is no `/networks` endpoint for airtime — instead `GET /api/v1/utility/billers?category=AIRTIME` returns networks
- There is no `/plans` endpoint for data — instead `GET /api/v1/utility/products?category=DATA&biller=MTN` returns plans
- Validation uses a single generic endpoint `POST /api/v1/utility/validate` (not per-service endpoints)
- Payment uses a single generic endpoint `POST /api/v1/utility/pay` (not per-service endpoints)

**Fix required:**  
Rewrite `billing.api.ts` entirely to use the `/api/v1/utility/*` API contract. This requires:
1. Mapping `getAirtimeNetworks()` → `GET /api/v1/utility/billers?category=AIRTIME`
2. Mapping `buyAirtime({networkCode, phoneNumber, amount})` → `POST /api/v1/utility/pay {category: 'AIRTIME', biller_id: networkCode, customer_reference: phoneNumber, amount_kobo: amount * 100}`
3. Similarly for data, electricity (with validate step), cable (with validate step)
4. The idempotency key must be sent as `Idempotency-Key` header (not in body)
5. Auth is **required** for all utility endpoints (mobile currently sends Bearer token, which should work)

---

### Gap 3 — Wallet Endpoint Path Mismatch (P0)

**Module:** Wallet  
**Affected Screens:** `wallet.tsx` (all functions), `(tabs)/index.tsx` (balance display)  
**Complexity:** Medium  
**Business Risk:** Users cannot view or fund their wallet

**Root Cause:**  
`wallet.api.ts` calls:
- `GET /wallet` → actual: `GET /api/v1/wallet/balance`
- `GET /wallet/transactions` → actual: `GET /api/v1/wallet/transactions`
- `POST /wallet/fund/initiate` → actual: `POST /api/v1/wallet/topup`
- `POST /wallet/fund/verify` → **no such route exists** (verification happens via Paystack webhook)

**Response schema mismatches also exist:**
- Backend returns `{available_kobo, currency, account_id}` but `wallet.mapper.ts` reads `record.balance` and `record.currency`
- Backend `topup` requires `amount_kobo` (integer kobo) but mobile sends `{ amount: Number(amount) }` — could be naira, not kobo
- Backend `topup` requires `Idempotency-Key` header — mobile does not send this

**Fix required:**
1. Update `wallet.api.ts` paths to `/api/v1/wallet/balance`, `/api/v1/wallet/transactions`, `/api/v1/wallet/topup`
2. Update `wallet.mapper.ts` to read `available_kobo` field
3. Convert naira input to kobo before sending topup request
4. Add `Idempotency-Key` header to topup request
5. Remove `verifyWalletFunding` — wallet verification happens server-side via Paystack webhook

---

### Gap 4 — Dashboard Endpoint Missing (P0)

**Module:** Home Screen  
**Affected Screens:** `(tabs)/index.tsx`  
**Complexity:** Medium  
**Business Risk:** Home screen always shows error state; first impression broken

**Root Cause:**  
`dashboard.api.ts` calls `GET /dashboard` — no such route exists anywhere. The home screen calls `getDashboard()` on mount and shows an error card when it fails.

**Fix required:**  
Create `frontend-web/app/api/dashboard/route.ts` that aggregates:
- Wallet balance from `getBalance(userId)`
- User profile from Supabase auth
- Recent transactions from `listTransactions(userId, {limit: 5})`

OR update `dashboard.api.ts` to call individual endpoints and assemble the dashboard client-side:
- `GET /api/v1/wallet/balance` for balance
- `GET /api/auth/me` for user info
- `GET /api/v1/utility/transactions` for recent transactions

---

### Gap 5 — Transaction Endpoints Missing (P0)

**Module:** Transaction History  
**Affected Screens:** `transactions/index.tsx`, `transactions/[id].tsx`, `receipt/[id].tsx`  
**Complexity:** Medium  
**Business Risk:** Users cannot review their transaction history — a core feature for a fintech app

**Root Cause:**  
`transactions.api.ts` calls:
- `GET /transactions` — no such route
- `GET /transactions/:id` — no such route
- `GET /transactions/:id/receipt` — no such route (the utility receipt is at `/api/v1/utility/transactions/:id/receipt`)
- `POST /transactions/:id/retry` — no such route (requery is at `/api/v1/utility/transactions/:id/requery`)

The utility transactions API exists at `/api/v1/utility/transactions/*` but the mobile doesn't use it.

**Fix required:**  
Update `transactions.api.ts` paths:
- `getTransactions()` → `GET /api/v1/utility/transactions`
- `getTransaction(id)` → `GET /api/v1/utility/transactions/:id`
- `getReceipt(id)` → `GET /api/v1/utility/transactions/:id/receipt`
- `retryTransaction(id)` → `POST /api/v1/utility/transactions/:id/requery`

Response field names will need alignment (utility API returns different field names).

---

### Gap 6 — Paid Vote Initiate Path Wrong (P0)

**Module:** Voting (Paid)  
**Affected Screens:** `payment-method.tsx`  
**Complexity:** Low  
**Business Risk:** Paid voting revenue blocked

**Root Cause:**  
`voting.api.ts` line 157 calls `POST /api/v2/votes/paid/initiate`. This path does not exist. The actual route is `POST /api/votes/paid/initiate` (no `/v2/` prefix, at `/frontend-web/app/api/votes/paid/initiate/route.ts`).

Additionally, the existing `/api/votes/paid/initiate` route requires `voterEmail` and `voterName` in the request body, but `initiatePaidVote()` sends `{contestantId, contestId, packageId, paymentMethod, idempotencyKey}`. Neither `voterEmail` nor `voterName` is sent.

**Fix required:**
1. Change path in `voting.api.ts` from `/api/v2/votes/paid/initiate` to `/api/votes/paid/initiate`
2. Add `voterEmail` and `voterName` to the request (requires user profile to be available, or add them to the route params)
3. OR update the backend route to make `voterEmail`/`voterName` optional when a Bearer token is present

---

### Gap 7 — Contestant Registration is Fake (P1)

**Module:** Contest Registration  
**Affected Screens:** `contest/register.tsx`  
**Complexity:** High  
**Business Risk:** No contestant registrations are captured from mobile

**Root Cause:**  
`contest/register.tsx` (lines 321-326) uses:
```js
setTimeout(() => {
  setSubmitting(false);
  Alert.alert('Application Submitted! 🌟', ...);
}, 1_500);
```
There is no API call. The `onNext` function when `step === 2` calls `setTimeout` instead of submitting to an API. Photo upload uses `Alert.alert('Camera roll picker will open here...')`.

**Fix required:**
1. Wire the submit button to `POST /api/registration/applications` or `POST /api/open-mic/contests/:slug/apply`
2. Implement actual photo upload using `POST /api/open-mic/uploads/presign` → R2 upload → `POST /api/open-mic/uploads/complete`
3. Map the registration form fields to the API's expected payload format

---

### Gap 8 — Vote Success Screen Uses Hardcoded Data (P1)

**Module:** Voting  
**Affected Screens:** `payment-method.tsx`, `vote-success.tsx`  
**Complexity:** Low  
**Business Risk:** Success screen shows incorrect data after wallet payment

**Root Cause:**  
In `payment-method.tsx` lines 54-59, the wallet payment success path navigates to `vote-success` with hardcoded values:
```js
newTotal: (parseInt(params.voteCount, 10) + 34200).toString(),
freeVotesRemaining: '3',
```
`34200` is a hardcoded vote count. The `freeVotesRemaining` is hardcoded as `'3'`. These should come from the `initiatePaidVote` response.

**Fix required:**  
After wallet payment succeeds, use the actual `result.votesToCredit` and re-fetch `freeVotesRemaining` from `/api/votes/remaining` before navigating to the success screen.

---

### Gap 9 — Invest Screen is Static Placeholder (P1)

**Module:** Invest Tab  
**Affected Screens:** `(tabs)/invest.tsx`  
**Complexity:** High (requires new backend feature)  
**Business Risk:** Tab exists in navigation but shows nothing useful

**Root Cause:**  
`invest.tsx` is a static card with text: `"Investment products will appear here when enabled by the backend."` No API calls, no data.

**Fix required:**  
Either hide the Invest tab until the feature is built, or implement the backend module. Do not ship a dead tab to production.

---

### Gap 10 — `verifyPaidVote` Function Exists but Is Never Called (P2)

**Module:** Voting (Paid)  
**Affected Screens:** None  
**Complexity:** Medium  
**Business Risk:** Paid votes via Paystack are never confirmed

**Root Cause:**  
`voting.api.ts` exports `verifyPaidVote()` which calls `POST /api/v2/votes/paid/verify`. This function is never imported or called from any screen. After a Paystack payment, there is no screen or hook that verifies the payment and credits votes.

**Fix required:**  
After `initiatePaidVote` returns an `authorizationUrl`, the user should be shown a Paystack WebView or deep-linked to the Paystack payment page, then returned to a callback screen that calls `verifyPaidVote()`.

---

### Gap 11 — Wallet Mapper Response Field Mismatch (P2)

**Module:** Wallet  
**Affected Screens:** `wallet.tsx`  
**Complexity:** Low

**Root Cause:**  
`wallet.mapper.ts` reads `record.balance` but the backend (`/api/v1/wallet/balance`) returns `available_kobo`. The mapper has no fallback for `available_kobo`. After fixing the path, the balance will show `0` unless the mapper is also updated.

**Fix required:**  
```ts
// wallet.mapper.ts — add available_kobo fallback
balance: Number(record.balance ?? record.available_kobo ?? 0),
```

---

### Gap 12 — No KYC Screen (P2)

**Module:** KYC / Identity Verification  
**Affected Screens:** None  
**Complexity:** High  
**Business Risk:** Wallet is locked behind KYC Tier 1 but mobile has no way to complete KYC

**Root Cause:**  
`GET /api/v1/wallet/balance` and all wallet endpoints call `requireKycTier(user.id, 1)`. If the user has not completed KYC, they receive a `403` response with no UI path to resolve it. There is no KYC screen in the mobile app.

**Fix required:**  
Add a KYC screen that calls `GET /api/v1/kyc/me` to check current status and `POST /api/v1/kyc/initiate` to start the process. Wire the wallet screen to detect KYC-403 errors and redirect to the KYC screen.

---

### Gap 13 — `payment-method.tsx` Passes Paystack URL Directly to Router (P2)

**Module:** Voting (Paid)  
**Affected Screens:** `payment-method.tsx` line 49  
**Complexity:** Medium  
**Business Risk:** App crashes or does nothing on Paystack payment flow

**Root Cause:**  
```js
router.push(result.authorizationUrl);  // line 49
```
`router.push()` in Expo Router expects a local route path, not an external HTTPS URL. This will either crash or do nothing.

**Fix required:**  
Use `Linking.openURL(result.authorizationUrl)` for external URLs, or implement a `WebView` screen that loads the Paystack checkout.

---

### Gap 14 — No Leaderboard `rankChange` from Backend (P3)

**Module:** Voting (Leaderboard)  
**Affected Screens:** `contest/[id]/leaderboard.tsx`  
**Complexity:** Low

**Root Cause:**  
`/api/v1/contests/:id/leaderboard/route.ts` always returns `rankChange: 'same'` (hardcoded, line 48). The leaderboard screen renders trend arrows for `up`/`down`/`same` movement, but will always show `—` for all entries.

**Fix required:**  
Store previous rank in the `vote_totals` table and return actual rank changes.

---

### Gap 15 — No Contest Registration API Route (P3)

**Module:** Contest Registration  
**Affected Screens:** `contest/register.tsx`  
**Complexity:** High

**Root Cause:**  
Beyond the fake `setTimeout` submit, there is no mobile-accessible API route specifically for contestant self-registration. The registration API routes (`/api/registration/applications/*`) are used by the web app's wizard flow.

**Fix required:**  
Expose the existing registration endpoint or create a dedicated mobile registration route, then wire `contest/register.tsx` to it.

---

## 7. Screens Using Mock / Static Data

| Screen | Mock/Static Pattern | Location |
|--------|--------------------|----|
| `contest/register.tsx` | `setTimeout` fake submit (1.5s delay + Alert) | Lines 321–326 |
| `contest/register.tsx` | `Alert.alert('Camera roll picker will open here...')` for photo upload | Line 205 |
| `contest/register.tsx` | Hardcoded `CATEGORIES` array: `['Vocalist', 'Dance', 'Comedy', 'Magic', 'Spoken Word', 'Talent']` | Line 37 |
| `contest/register.tsx` | Hardcoded `LOCATIONS` array: `['Lagos', 'Abuja', 'Port Harcourt', ...]` | Line 38 |
| `(tabs)/invest.tsx` | Static placeholder card with no data | Entire component |
| `payment-method.tsx` | Hardcoded `newTotal: (parseInt(params.voteCount, 10) + 34200).toString()` | Line 57 |
| `payment-method.tsx` | Hardcoded `freeVotesRemaining: '3'` | Line 58 |
| `contest/[id].tsx` | `contestId: 'open-mic-2026'` fallback hardcoded (line 41, `payment-method.tsx`) | `payment-method.tsx` line 41 |

---

## 8. Backend Endpoints Not Connected to Mobile

These endpoints exist in the backend but no mobile screen or API service file uses them:

| Endpoint | Notes |
|----------|-------|
| `GET /api/v1/utility/transactions` | Mobile's `transactions.api.ts` calls wrong path |
| `GET /api/v1/utility/transactions/:id` | Same |
| `GET /api/v1/utility/transactions/:id/receipt` | Same |
| `GET /api/v1/utility/transactions/:id/dispute` | Not exposed in mobile |
| `GET /api/v1/utility/beneficiaries` | No saved-beneficiaries screen |
| `POST /api/v1/utility/beneficiaries` | No screen |
| `GET /api/v1/kyc/me` | No KYC screen |
| `POST /api/v1/kyc/initiate` | No KYC screen |
| `GET /api/v1/virtual-accounts/me` | No virtual account screen |
| `GET /api/me` | No profile screen (only More tab shows basic user data) |
| `POST /api/me/profile` | No profile edit screen |
| `POST /api/v2/votes/paid/verify` | `verifyPaidVote()` function defined but never called |
| `POST /api/votes/paid/initiate` | Called but with wrong path (`/v2/votes/paid/initiate`) |
| All `/api/v1/utility/billers`, `/api/v1/utility/products`, `/api/v1/utility/categories` | Mobile uses wrong `/services/*` paths instead |

---

## 9. Mobile Screens Without Backend Support

| Screen | Missing Backend |
|--------|----------------|
| `(tabs)/index.tsx` | `GET /dashboard` does not exist |
| `(tabs)/invest.tsx` | No investment API exists anywhere |
| `contest/register.tsx` | No mobile registration API wired (fake submit) |
| `transactions/index.tsx` | `GET /transactions` does not exist |
| `transactions/[id].tsx` | `GET /transactions/:id` and `POST /transactions/:id/retry` do not exist |
| `receipt/[id].tsx` | `GET /transactions/:id/receipt` (at root) does not exist |
| Auth screens (all) | No Next.js auth proxy; Go backend is on different URL/paths |

---

## 10. API Contract Mismatches

| Mobile Call | Actual Backend Contract | Mismatch |
|-------------|------------------------|----------|
| `POST /auth/login` body: `{email, password}` | Go: `POST /api/auth/login` | **Path mismatch** |
| `POST /auth/forgot-password` | Go: `POST /api/auth/request-password-reset` | **Path name mismatch** |
| `POST /auth/verify-otp` | Go: `GET /api/auth/verify-email` | **Method + path mismatch** |
| `POST /auth/resend-otp` | Go: `POST /api/auth/resend-verification-link` | **Path name mismatch** |
| `GET /wallet` → `mapWalletFromApi({balance})` | `GET /api/v1/wallet/balance` → `{available_kobo}` | **Path + field name** |
| `POST /wallet/fund/initiate` body: `{amount: Number}` | `POST /api/v1/wallet/topup` body: `{amount_kobo: integer}` | **Path + field + unit (naira vs kobo)** + missing `Idempotency-Key` header |
| `POST /api/v2/votes/paid/initiate` body: `{contestantId, contestId, packageId, paymentMethod}` | `POST /api/votes/paid/initiate` body requires `{voterEmail, voterName, contestId, contestantId, packageId}` | **Path mismatch + missing required fields** |
| `GET /transactions` | `GET /api/v1/utility/transactions` | **Path mismatch** |
| `GET /transactions/:id` | `GET /api/v1/utility/transactions/:id` | **Path mismatch** |
| `GET /transactions/:id/receipt` | `GET /api/v1/utility/transactions/:id/receipt` | **Path mismatch** |
| `POST /transactions/:id/retry` | `POST /api/v1/utility/transactions/:id/requery` | **Path + name mismatch** |
| `GET /services/airtime/networks` | `GET /api/v1/utility/billers?category=AIRTIME` | **Path + schema mismatch** |
| `GET /services/data/plans?networkCode=` | `GET /api/v1/utility/products?category=DATA&biller=` | **Path + query param name mismatch** |
| `POST /services/electricity/validate` body: `{discoCode, meterNumber, meterType}` | `POST /api/v1/utility/validate` body: `{category, biller_id, customer_reference}` | **Path + all field names** |
| `POST /services/airtime/purchase` body: `{networkCode, phoneNumber, amount, paymentMethod}` | `POST /api/v1/utility/pay` body: `{category, biller_id, customer_reference, amount_kobo}` | **Path + field names + unit** |

---

## 11. TODO Roadmap by Priority

### P0 — Must fix before any production testing

1. **Fix auth routing** — Create Next.js proxy routes at `frontend-web/app/api/auth/` or update `EXPO_PUBLIC_API_BASE_URL` + align endpoint path names in `auth.api.ts`
2. **Fix wallet paths** — Update `wallet.api.ts` to use `/api/v1/wallet/*` paths + fix field names and units
3. **Fix billing paths** — Rewrite `billing.api.ts` to use `/api/v1/utility/*` generic API contract
4. **Create dashboard endpoint** — Add `frontend-web/app/api/dashboard/route.ts` aggregating wallet + profile + recent transactions
5. **Fix transaction paths** — Update `transactions.api.ts` to use `/api/v1/utility/transactions/*`
6. **Fix paid vote initiate path** — Change `/api/v2/votes/paid/initiate` to `/api/votes/paid/initiate` + add missing fields

### P1 — Fix before beta release

7. **Wire contest registration** — Replace `setTimeout` fake submit with real API call
8. **Fix vote-success hardcoded data** — Use actual response data instead of `34200` and `'3'`
9. **Fix Paystack redirect** — Replace `router.push(authorizationUrl)` with `Linking.openURL()` + add verify flow
10. **Remove or wire Invest tab** — Either hide the tab or implement backend

### P2 — Fix before public launch

11. **Add KYC screen** — Users need to complete KYC to use wallet features
12. **Fix wallet mapper** — Update to read `available_kobo` field
13. **Wire `verifyPaidVote`** — Connect verification to post-Paystack callback
14. **Add virtual account screen** — Surface `/api/v1/virtual-accounts/me` data
15. **Add beneficiaries screen** — Surface `/api/v1/utility/beneficiaries` for repeat payments

### P3 — Quality improvements

16. **Fix leaderboard rankChange** — Store and return actual rank movement history
17. **Align `forgotPassword` path** — `request-password-reset` vs `forgot-password`
18. **Remove `verifyWalletFunding`** — Function has no backend counterpart; remove to avoid confusion

---

## 12. Recommended Implementation Order

1. **Environment/routing** — Decide on one canonical auth server and set `EXPO_PUBLIC_API_BASE_URL` correctly. This unblocks all auth screens.
2. **Auth alignment** — Update `auth.api.ts` path names to match Go backend. Test login/register end-to-end.
3. **Wallet** — Fix paths + mapper + topup unit. Test wallet balance display.
4. **Dashboard** — Create aggregation endpoint. Test home screen loads.
5. **Billing** — Rewrite `billing.api.ts` against utility API. This is the most complex change. Test each service type individually.
6. **Transactions** — Update paths. Test history list and detail.
7. **Paid voting** — Fix path + add missing fields + implement WebView/Linking redirect + verify callback.
8. **KYC** — Add screen so users can unlock wallet.
9. **Contest registration** — Wire submit to API.
10. **Nice-to-haves** — Invest tab, beneficiaries, virtual account.

---

## 13. Testing Checklist

### Auth
- [ ] User can register with fullName, email, phone, password
- [ ] User receives OTP/verification email after registration
- [ ] User can verify OTP
- [ ] User can log in with email/password and receive access token
- [ ] `GET /auth/me` (or equivalent) returns correct user data
- [ ] 401 response triggers automatic logout and redirect to login
- [ ] Forgot password flow sends reset email

### Wallet
- [ ] Wallet balance loads and displays in naira (kobo converted correctly)
- [ ] Fund wallet initiates Paystack payment with correct amount
- [ ] Wallet transactions list loads with correct pagination
- [ ] Wallet feature flag `featureFlags.wallet()` is enabled in production env

### Bills
- [ ] Airtime networks load and display correctly
- [ ] Airtime purchase debits wallet and returns transaction ID
- [ ] Data networks and plans load correctly
- [ ] Data purchase completes and routes to receipt
- [ ] Electricity discos load; meter validation returns customer name
- [ ] Electricity payment completes and returns token
- [ ] Cable providers and packages load correctly
- [ ] Cable payment completes and routes to receipt

### Voting
- [ ] Contest list loads from backend (not empty)
- [ ] Contest categories display correctly
- [ ] Contestant list loads with vote counts
- [ ] Leaderboard loads and shows rank order
- [ ] Free vote casts successfully and decrements remaining count
- [ ] Vote packages load for a given contest
- [ ] Paid vote initiates and redirects to Paystack
- [ ] Post-Paystack return verifies payment and credits votes
- [ ] Vote success screen shows correct contestant name and vote count

### Transactions
- [ ] Transaction list loads correctly
- [ ] Transaction detail shows all fields
- [ ] Receipt screen shows token (electricity) where applicable
- [ ] Failed transactions show retry button
- [ ] PROCESSING transactions show refresh button

### KYC (once implemented)
- [ ] KYC status shows in profile
- [ ] Wallet returns 403 when KYC is incomplete, with actionable error
- [ ] User can initiate KYC from the error state
