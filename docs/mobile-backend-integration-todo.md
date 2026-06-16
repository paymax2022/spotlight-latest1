# Mobile ↔ Backend Integration TODO

**Generated:** 2026-06-15  
**Full audit:** `docs/mobile-backend-endpoint-audit.md`

---

## P0 — Production Blockers (Fix Immediately)

- [x] **[AUTH-1] Fix auth endpoint routing architecture**
  - Module: Authentication
  - Priority: P0
  - Backend file(s): `backend/internal/app/router.go` (Go auth at `/api/auth/*`)
  - Frontend file(s): `apps/mobile-starter/src/api/auth.api.ts`, `apps/mobile-starter/.env`
  - Acceptance criteria:
    - `POST /auth/login` with `{email, password}` returns `{user, accessToken}` from the mobile's `EXPO_PUBLIC_API_BASE_URL`
    - Either: Next.js proxy routes at `frontend-web/app/api/auth/[...path]/route.ts` forward to Go backend, OR `EXPO_PUBLIC_API_BASE_URL` is changed to point to Go backend directly with paths aligned
    - Login screen successfully authenticates a test user and routes to protected tabs

- [x] **[AUTH-2] Fix `forgotPassword` endpoint path mismatch**
  - Module: Authentication
  - Priority: P0
  - Backend file(s): `backend/internal/app/router.go` line 59 — `POST /api/auth/request-password-reset`
  - Frontend file(s): `apps/mobile-starter/src/api/auth.api.ts` line 51 — calls `POST /auth/forgot-password`
  - Acceptance criteria: Rename mobile call to `request-password-reset` OR add alias route in backend

- [x] **[AUTH-3] Fix `verifyOtp` method and path mismatch**
  - Module: Authentication
  - Priority: P0
  - Backend file(s): `backend/internal/app/router.go` line 61 — `GET /api/auth/verify-email`
  - Frontend file(s): `apps/mobile-starter/src/api/auth.api.ts` line 41 — calls `POST /auth/verify-otp`
  - Acceptance criteria: Method (GET vs POST) and path aligned; OTP verification screen works end-to-end

- [x] **[AUTH-4] Fix `resendOtp` path mismatch**
  - Module: Authentication
  - Priority: P0
  - Backend file(s): `backend/internal/app/router.go` line 62 — `POST /api/auth/resend-verification-link`
  - Frontend file(s): `apps/mobile-starter/src/api/auth.api.ts` line 45 — calls `POST /auth/resend-otp`
  - Acceptance criteria: Resend OTP button triggers correct backend route

- [x] **[WALLET-1] Fix wallet balance endpoint path and response mapper**
  - Module: Wallet
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/wallet/balance/route.ts` — responds with `{available_kobo, currency, account_id}`
  - Frontend file(s): `apps/mobile-starter/src/api/wallet.api.ts` line 7 — calls `GET /wallet`; `apps/mobile-starter/src/api/mappers/wallet.mapper.ts` line 12 — reads `record.balance`
  - Acceptance criteria:
    - `wallet.api.ts` `getWallet()` calls `GET /api/v1/wallet/balance` (not `/wallet`)
    - `wallet.mapper.ts` reads `available_kobo` field: `balance: Number(record.balance ?? record.available_kobo ?? 0)`
    - Wallet screen displays correct balance in naira

- [x] **[WALLET-2] Fix wallet transactions path**
  - Module: Wallet
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/wallet/transactions/route.ts` — responds with `{transactions, meta}`
  - Frontend file(s): `apps/mobile-starter/src/api/wallet.api.ts` line 11 — calls `GET /wallet/transactions`
  - Acceptance criteria: `getWalletTransactions()` calls `GET /api/v1/wallet/transactions`; wallet screen shows transaction list

- [x] **[WALLET-3] Fix wallet topup path, field names, and unit conversion**
  - Module: Wallet
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/wallet/topup/route.ts` — expects `{amount_kobo: integer}` + `Idempotency-Key` header
  - Frontend file(s): `apps/mobile-starter/src/api/wallet.api.ts` line 17 — calls `POST /wallet/fund/initiate` with `{amount: Number(amount)}`; `apps/mobile-starter/app/(protected)/(tabs)/wallet.tsx` line 25
  - Acceptance criteria:
    - `initiateWalletFunding()` calls `POST /api/v1/wallet/topup`
    - Body uses `amount_kobo` (amount × 100, integer)
    - `Idempotency-Key` header is sent (generate with `generateIdempotencyKey()`)
    - Response fields `authorization_url` and `payment_reference` are returned to the screen

- [x] **[WALLET-4] Remove `verifyWalletFunding` (no backend route)**
  - Module: Wallet
  - Priority: P0
  - Backend file(s): None — verification happens via Paystack webhook at `frontend-web/app/api/webhooks/paystack/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/wallet.api.ts` lines 22-25
  - Acceptance criteria: Function removed; any call sites removed; wallet screens do not attempt manual verification

- [x] **[BILLING-1] Rewrite `getAirtimeNetworks()` to use utility billers API**
  - Module: Bills — Airtime
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/billers/route.ts` — `GET ?category=AIRTIME` returns `{billers: [{id, name, code, logoUrl}]}`
  - Frontend file(s): `apps/mobile-starter/src/api/billing.api.ts` line 5 — calls `GET /services/airtime/networks`
  - Acceptance criteria: `getAirtimeNetworks()` calls `GET /api/v1/utility/billers?category=AIRTIME`; returns list mapped to `Network[]` shape; airtime screen loads networks

- [x] **[BILLING-2] Rewrite `buyAirtime()` to use utility pay API**
  - Module: Bills — Airtime
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/pay/route.ts` — `POST` expects `{category, biller_id, customer_reference, amount_kobo}` + `Idempotency-Key` header
  - Frontend file(s): `apps/mobile-starter/src/api/billing.api.ts` line 10 — calls `POST /services/airtime/purchase` with `{networkCode, phoneNumber, amount, paymentMethod, idempotencyKey}`
  - Acceptance criteria:
    - `buyAirtime()` calls `POST /api/v1/utility/pay` with `{category: 'AIRTIME', biller_id: networkCode, customer_reference: phoneNumber, amount_kobo: amount * 100}`
    - `Idempotency-Key: idempotencyKey` header included
    - Airtime purchase completes and returns `transactionId`

- [x] **[BILLING-3] Rewrite `getDataNetworks()` and `getDataPlans()` to use utility API**
  - Module: Bills — Data
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/billers/route.ts`, `frontend-web/app/api/v1/utility/products/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/billing.api.ts` lines 21-29 — calls `/services/data/networks` and `/services/data/plans`
  - Acceptance criteria:
    - `getDataNetworks()` calls `GET /api/v1/utility/billers?category=DATA`
    - `getDataPlans(networkCode)` calls `GET /api/v1/utility/products?category=DATA&biller={networkCode}`
    - Products mapped to `DataPlan[]` shape with `id`, `name`, `sellingPrice`, `allowance`, `validity`

- [x] **[BILLING-4] Rewrite `buyData()` to use utility pay API**
  - Module: Bills — Data
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/pay/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/billing.api.ts` line 31 — calls `POST /services/data/purchase`
  - Acceptance criteria: `buyData()` calls `POST /api/v1/utility/pay` with `{category: 'DATA', biller_id: networkCode, product_id: planId, customer_reference: phoneNumber}` + `Idempotency-Key` header

- [x] **[BILLING-5] Rewrite `getElectricityDiscos()` to use utility billers API**
  - Module: Bills — Electricity
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/billers/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/billing.api.ts` line 42 — calls `GET /services/electricity/discos`
  - Acceptance criteria: `getElectricityDiscos()` calls `GET /api/v1/utility/billers?category=ELECTRICITY`; returns `Disco[]` with `supportsPrepaid`/`supportsPostpaid` fields (or derive from biller metadata)

- [x] **[BILLING-6] Rewrite `validateMeter()` to use utility validate API**
  - Module: Bills — Electricity
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/validate/route.ts` — expects `{category, biller_id, customer_reference}` (no `meterType`)
  - Frontend file(s): `apps/mobile-starter/src/api/billing.api.ts` line 47 — calls `POST /services/electricity/validate` with `{discoCode, meterNumber, meterType}`
  - Acceptance criteria:
    - `validateMeter()` calls `POST /api/v1/utility/validate` with `{category: 'ELECTRICITY', biller_id: discoCode, customer_reference: meterNumber}`
    - `meterType` passed as metadata or determined by product selection
    - Response mapped to `ValidationResult` shape with `customerName`

- [x] **[BILLING-7] Rewrite `payElectricity()` to use utility pay API**
  - Module: Bills — Electricity
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/pay/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/billing.api.ts` line 56 — calls `POST /services/electricity/pay`
  - Acceptance criteria: `payElectricity()` calls `POST /api/v1/utility/pay` with correct field names + kobo amount + `Idempotency-Key` header

- [x] **[BILLING-8] Rewrite `getCableProviders()` and `getCablePackages()` to use utility API**
  - Module: Bills — Cable TV
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/billers/route.ts`, `frontend-web/app/api/v1/utility/products/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/billing.api.ts` lines 70-78 — calls `/services/cable/providers` and `/services/cable/packages`
  - Acceptance criteria: Both functions call the utility billers/products API; packages mapped to `CablePackage[]` shape with `name`, `sellingPrice`, `duration`

- [x] **[BILLING-9] Rewrite `validateCable()` and `payCable()` to use utility API**
  - Module: Bills — Cable TV
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/validate/route.ts`, `frontend-web/app/api/v1/utility/pay/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/billing.api.ts` lines 80-96 — calls `/services/cable/validate` and `/services/cable/pay`
  - Acceptance criteria: Both functions call utility API with `category: 'CABLE_TV'`; cable payment completes and routes to receipt

- [x] **[DASHBOARD-1] Create `/api/dashboard` endpoint or replace with client-side aggregation**
  - Module: Home Screen
  - Priority: P0
  - Backend file(s): Create `frontend-web/app/api/dashboard/route.ts` OR update `apps/mobile-starter/src/api/dashboard.api.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/dashboard.api.ts` line 6 — calls `GET /dashboard`; `apps/mobile-starter/app/(protected)/(tabs)/index.tsx` line 20
  - Acceptance criteria:
    - Home screen loads without error
    - Shows wallet balance, user name, and recent transactions
    - Dashboard data comes from real API (not mock)

- [x] **[TX-1] Fix `getTransactions()` path to use utility transactions API**
  - Module: Transaction History
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/transactions/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/transactions.api.ts` line 5 — calls `GET /transactions`
  - Acceptance criteria: `getTransactions()` calls `GET /api/v1/utility/transactions`; transaction list screen loads

- [x] **[TX-2] Fix `getTransaction()` path**
  - Module: Transaction History
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/transactions/[id]/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/transactions.api.ts` line 20 — calls `GET /transactions/:id`
  - Acceptance criteria: `getTransaction(id)` calls `GET /api/v1/utility/transactions/:id`; transaction detail screen loads

- [x] **[TX-3] Fix `getReceipt()` path**
  - Module: Transaction History
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/transactions/[id]/receipt/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/transactions.api.ts` line 24 — calls `GET /transactions/:id/receipt`
  - Acceptance criteria: `getReceipt(id)` calls `GET /api/v1/utility/transactions/:id/receipt`; receipt screen loads

- [x] **[TX-4] Fix `retryTransaction()` path**
  - Module: Transaction History
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/v1/utility/transactions/[id]/requery/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/transactions.api.ts` line 30 — calls `POST /transactions/:id/retry`
  - Acceptance criteria: `retryTransaction(id)` calls `POST /api/v1/utility/transactions/:id/requery`; retry button in transaction detail works

- [x] **[VOTE-1] Fix paid vote initiate endpoint path**
  - Module: Voting (Paid)
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/votes/paid/initiate/route.ts` — at `/api/votes/paid/initiate` (no `/v2/`)
  - Frontend file(s): `apps/mobile-starter/src/api/voting.api.ts` line 157 — calls `POST /api/v2/votes/paid/initiate`
  - Acceptance criteria: Path changed to `/api/votes/paid/initiate`; request no longer 404s

- [x] **[VOTE-2] Add missing `voterEmail` and `voterName` to paid vote initiate request**
  - Module: Voting (Paid)
  - Priority: P0
  - Backend file(s): `frontend-web/app/api/votes/paid/initiate/route.ts` lines 26-27 — validates `voterEmail` and `voterName` as required
  - Frontend file(s): `apps/mobile-starter/src/api/voting.api.ts` line 150; `apps/mobile-starter/app/(protected)/contest/payment-method.tsx` line 37
  - Acceptance criteria:
    - `initiatePaidVote()` includes `voterEmail` and `voterName` from the authenticated user's profile
    - OR backend route updated to make these optional when Bearer token is provided
    - `payment-method.tsx` loads user profile (from `useAuthStore` or `getMe()`) and passes email/name to `initiatePaidVote()`

---

## P1 — Must Fix Before Beta

- [ ] **[REG-1] Wire contest registration form submit to real API**
  - Module: Contest Registration
  - Priority: P1
  - Backend file(s): `frontend-web/app/api/registration/applications/route.ts` or `frontend-web/app/api/open-mic/contests/[slug]/apply/route.ts`
  - Frontend file(s): `apps/mobile-starter/app/(protected)/contest/register.tsx` lines 319-326 — `setTimeout` fake submit
  - Acceptance criteria:
    - Remove `setTimeout` fake submit (lines 321-326)
    - Add `useMutation` that calls the appropriate registration endpoint
    - Form data `{fullName, stageName, category, location, bio}` maps to API payload
    - On success: show confirmation; on error: show error message
    - Screen navigates away on success instead of showing fake alert

- [ ] **[REG-2] Wire photo upload in registration (Step 2) to R2 presigned upload**
  - Module: Contest Registration
  - Priority: P1
  - Backend file(s): `frontend-web/app/api/open-mic/uploads/presign/route.ts`, `frontend-web/app/api/open-mic/uploads/complete/route.ts`
  - Frontend file(s): `apps/mobile-starter/app/(protected)/contest/register.tsx` line 205 — `Alert.alert('Camera roll picker will open here...')`
  - Acceptance criteria:
    - Tapping photo area opens device camera roll (using `expo-image-picker` or `expo-media-library`)
    - Selected photo uploads via presigned R2 URL
    - `photoUri` in form state updated to the uploaded R2 URL
    - Photo displayed in preview and sent with registration submission

- [ ] **[VOTE-3] Fix hardcoded `newTotal` and `freeVotesRemaining` in payment success**
  - Module: Voting (Paid)
  - Priority: P1
  - Backend file(s): N/A
  - Frontend file(s): `apps/mobile-starter/app/(protected)/contest/payment-method.tsx` lines 57-58
  - Acceptance criteria:
    - After wallet payment, `initiatePaidVote` response provides `votesToCredit`
    - `newTotal` computed from contestant's current `voteCount + votesToCredit`
    - `freeVotesRemaining` fetched from `/api/votes/remaining` before navigating to success screen
    - Hardcoded value `34200` removed entirely

- [ ] **[VOTE-4] Fix Paystack URL redirect in payment-method screen**
  - Module: Voting (Paid)
  - Priority: P1
  - Backend file(s): N/A
  - Frontend file(s): `apps/mobile-starter/app/(protected)/contest/payment-method.tsx` line 49 — `router.push(result.authorizationUrl)`
  - Acceptance criteria:
    - Replace `router.push(result.authorizationUrl)` with `Linking.openURL(result.authorizationUrl)` (from `react-native`)
    - OR implement an in-app `WebView` screen at `/contest/paystack-checkout` that loads `authorizationUrl`
    - After payment, user returns to app and `verifyPaidVote()` is called
    - Vote success screen shown after successful verification

- [ ] **[INVEST-1] Hide or gate Invest tab until backend feature exists**
  - Module: Invest
  - Priority: P1
  - Backend file(s): None
  - Frontend file(s): `apps/mobile-starter/app/(protected)/(tabs)/invest.tsx`, `apps/mobile-starter/app/(protected)/(tabs)/_layout.tsx`
  - Acceptance criteria: Invest tab is either hidden from the tab bar or replaced with a "Coming Soon" message that does not look broken; it does not appear as a dead screen

---

## P2 — Fix Before Public Launch

- [ ] **[KYC-1] Add KYC status screen**
  - Module: KYC
  - Priority: P2
  - Backend file(s): `frontend-web/app/api/v1/kyc/me/route.ts`, `frontend-web/app/api/v1/kyc/initiate/route.ts`
  - Frontend file(s): New screen — `apps/mobile-starter/app/(protected)/kyc.tsx` (does not exist yet)
  - Acceptance criteria:
    - New KYC screen calls `GET /api/v1/kyc/me` to display current tier and status
    - User can initiate KYC with `POST /api/v1/kyc/initiate`
    - When wallet endpoints return 403 (KYC required), error message includes a "Complete KYC" button that navigates to the KYC screen

- [ ] **[WALLET-5] Wire verify paid vote flow after Paystack callback**
  - Module: Voting (Paid)
  - Priority: P2
  - Backend file(s): `frontend-web/app/api/v2/votes/paid/verify/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/voting.api.ts` — `verifyPaidVote()` is defined but never called from any screen
  - Acceptance criteria:
    - After Paystack payment, app calls `POST /api/v2/votes/paid/verify` with `{transactionId, paymentReference}`
    - On success, vote success screen is shown with correct vote count
    - If verification fails, an error message is shown with retry option

- [ ] **[VA-1] Add virtual account info to wallet screen**
  - Module: Virtual Accounts
  - Priority: P2
  - Backend file(s): `frontend-web/app/api/v1/virtual-accounts/me/route.ts`
  - Frontend file(s): `apps/mobile-starter/app/(protected)/(tabs)/wallet.tsx`
  - Acceptance criteria:
    - Wallet screen calls `GET /api/v1/virtual-accounts/me` and displays bank account details
    - User can copy account number for bank transfer funding
    - Gracefully handles case where no virtual account is provisioned yet

- [ ] **[TX-5] Fix transaction mapper to handle utility API response shape**
  - Module: Transaction History
  - Priority: P2
  - Backend file(s): `frontend-web/app/api/v1/utility/transactions/route.ts`
  - Frontend file(s): `apps/mobile-starter/src/api/mappers/transaction.mapper.ts`
  - Acceptance criteria:
    - `mapTransactionFromApi()` correctly maps utility transaction fields to `Transaction` type
    - `serviceType` mapped from utility API's category field (e.g., `AIRTIME`, `DATA`, `ELECTRICITY`, `CABLE_TV`)
    - `customerIdentifier` mapped from `customer_reference` or `meter_number` as appropriate

- [ ] **[BENE-1] Add beneficiaries support to bill payment screens**
  - Module: Bills — All
  - Priority: P2
  - Backend file(s): `frontend-web/app/api/v1/utility/beneficiaries/route.ts`
  - Frontend file(s): All bill payment screens: `airtime.tsx`, `data.tsx`, `electricity.tsx`, `cable.tsx`
  - Acceptance criteria:
    - After successful payment, user is offered option to save as beneficiary
    - Bill payment screens show saved beneficiaries for quick refill
    - `GET /api/v1/utility/beneficiaries` and `POST /api/v1/utility/beneficiaries` are used

---

## P3 — Quality Polish

- [ ] **[LEADERBOARD-1] Return real `rankChange` data from leaderboard endpoint**
  - Module: Voting (Leaderboard)
  - Priority: P3
  - Backend file(s): `frontend-web/app/api/v1/contests/[id]/leaderboard/route.ts` line 48 — hardcodes `rankChange: 'same'`; `frontend-web/src/server/voting/totals.service.ts` (or similar)
  - Frontend file(s): `apps/mobile-starter/app/(protected)/contest/[id]/leaderboard.tsx`
  - Acceptance criteria:
    - `vote_totals` table stores previous rank or rank history
    - Leaderboard endpoint computes `rankChange` as `'up'`, `'down'`, or `'same'` from previous rank
    - Leaderboard screen shows correct trend arrows

- [ ] **[AUTH-5] Align `resetPassword` API path**
  - Module: Authentication
  - Priority: P3
  - Backend file(s): `backend/internal/app/router.go` line 60 — `POST /api/auth/reset-password`
  - Frontend file(s): `apps/mobile-starter/src/api/auth.api.ts` line 55 — calls `POST /auth/reset-password`
  - Acceptance criteria: Path aligned once routing architecture is fixed (can be done as part of AUTH-1)

- [ ] **[CLEANUP-1] Remove unused `verifyWalletFunding` function**
  - Module: Wallet
  - Priority: P3
  - Backend file(s): None (no endpoint exists)
  - Frontend file(s): `apps/mobile-starter/src/api/wallet.api.ts` lines 22-25
  - Acceptance criteria: Function removed; no compile errors; `wallet.tsx` does not reference it
