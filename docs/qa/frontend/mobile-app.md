# Surface: React Native Mobile App (`mobile-app/reactnative/`)

**Stack:** Expo Router (file-based routes in `app/`), 67 feature modules in `src/features/`.
**Risk tier: mixed.** The mobile app is the primary consumer surface — it drives the money
flows, the role apps (doctor/driver/merchant), and the mobile admin. Existing e2e:
`mobile-app/reactnative/tests/e2e/{auth,bills,wallet}` (Playwright, `page.route`-mocked).

This surface is validated **end-to-end**; backend behavior is covered in the module files.
Focus here on the user journey, client-side guards, and offline/error UX.

## 1. Flow groups in scope

- **Auth** `(auth)`: login, signup, verify-otp, forgot/reset-password.
- **Tabs** `(tabs)`: home, services, wallet, notifications, profile.
- **Money/wealth:** wallet, finance/transfers, crypto (buy/sell/swap/deposit/withdraw),
  stocks, invest (+onboarding/ai/settings), fx, savings (ajo/target/vault), fractionalre,
  loyalty, referral, kyc/kyc-verify.
- **Utilities/commerce:** services (bill pay/telemedicine), marketplace, food, nutrition,
  stays, mobility, events, realtor, insurance, health, crowdfunding, creators, learn.
- **Arena/social:** arena (quiz/exam/compete/predict/pot), connect (dating/networking/
  livestream), social (spray/split/pool/escrow), voting.
- **Community:** association, estate cluster (visitor/guard/security/facilities/dues/…).
- **Role apps:** `(doctor)` clinician portal, `(merchant)` portal, `app/admin/` (mobile admin
  for the trading backend).

## 2. Manual / e2e test cases (whole-journey)

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| MOB-E2E-001 | Login → home | P0 | seeded user | Enter creds → land on home tab | valid creds | Authenticated session; tabs load |
| MOB-E2E-002 | OTP verify path | P1 | pending user | Enter wrong OTP (reject) → resend → correct | — | Wrong rejected; correct verifies |
| MOB-E2E-003 | Wallet topup → balance | P0 | logged in | Topup via Paystack (sandbox) → return | kobo | Balance increases by exact amount after webhook |
| MOB-E2E-004 | Bill pay insufficient balance | P0 | low balance | Attempt utility pay | over-balance | Blocked with clear error; no debit (existing `bills/wallet-ledger.spec.ts`) |
| MOB-E2E-005 | Double-tap pay → one charge | P0 | funded | Double-click Pay | same op | Exactly 1 captured request/charge (existing e2e) |
| MOB-E2E-006 | Provider failover UX | P1 | primary provider fails | Pay when primary down | — | Fails over or shows retry; no double-charge (`bills/provider-failover.spec.ts`) |
| MOB-E2E-007 | Buy crypto → portfolio | P0 | funded, KYC ok | Buy asset → view portfolio | kobo | Order fills; holding + ledger reconcile (see `../frontend/trading-backend.md`) |
| MOB-E2E-008 | Transfer to Paymax user | P0 | funded, PIN set | Resolve recipient → send → enter PIN | kobo | Single debit; recipient credited; PIN required |
| MOB-E2E-009 | KYC gate blocks withdraw | P0 | unverified user | Attempt crypto/fx withdraw | — | Blocked with KYC-required prompt |
| MOB-E2E-010 | Book a stay → pay | P1 | funded | Search → select → pay | kobo | Booking confirmed; no overbooking; receipt |
| MOB-E2E-011 | Doctor portal consult flow | P1 | `qa-doctor` | Accept appointment → notes → prescription | — | Only assigned clinician can access patient record (object-level) |
| MOB-E2E-012 | Estate visitor code | P1 | resident | Generate visitor code → guard scans | — | Code valid once/within window; revoke works |
| MOB-SEC-001 | Session persistence & logout | P0 | logged in | Logout | — | Token cleared; protected screens redirect to login |
| MOB-SEC-002 | No secrets in bundle | P0 | — | Inspect `EXPO_PUBLIC_*` usage | — | Only public keys client-side; no service-role/provider secret |
| MOB-UX-001 | Offline / network error | P1 | airplane mode | Attempt a money action offline | — | Graceful error; no phantom success; retry safe (idempotent) |

## 3. Automated specs to add

- Extend Playwright beyond `{auth,bills,wallet}` to crypto-buy, transfer+PIN, and KYC-gated
  withdraw journeys (MOB-E2E-007/008/009).
- Add a doctor-portal object-level access e2e (MOB-E2E-011).
- Keep the `page.route` fixture + request-capture pattern (assert exactly-once on money ops).

## 4. Exit criteria

The money journeys (topup, bill pay, transfer, crypto buy, withdraw-gated) pass e2e with
exactly-once semantics; logout clears session; no client secret leakage; role apps enforce
object-level access.
