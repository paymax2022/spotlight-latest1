# Bills Payment QA Technical Map

Date: 2026-06-14

## App Stack

- Framework: Expo React Native with Expo Router.
- Web support: present through `react-native-web`; Playwright can automate `npm run web`.
- Navigation: file-based routes in `app/`, with protected app routing enforced by `app/_layout.tsx`.
- State/data: Zustand for auth state, TanStack Query for server state, React Hook Form + Zod for form validation.
- API client: Axios instance in `src/api/client.ts`; bearer token is loaded from `expo-secure-store`.
- Bills API client: `src/api/billing.api.ts`.
- Transaction API client: `src/api/transactions.api.ts`.
- Wallet API client: `src/api/wallet.api.ts`.

## Relevant Routes and Screens

| Area | Route | Main file | Status |
| --- | --- | --- | --- |
| Bills landing | `/services/bills` | `app/services/bills.tsx` | Exists |
| Airtime purchase | `/services/airtime` | `app/services/airtime.tsx` | Exists |
| Data purchase | `/services/data` | `app/services/data.tsx` | Exists |
| Electricity prepaid/postpaid | `/services/electricity` | `app/services/electricity.tsx` | Partial: one combined screen |
| Cable TV | `/services/cable-tv` | `app/services/cable-tv.tsx` | Exists |
| Receipt | `/services/receipt/[id]` | `app/services/receipt/[id].tsx` | Exists |
| Transaction history | `/services/transactions` | `app/services/transactions/index.tsx` | Exists |
| Transaction detail | `/services/transactions/[id]` | `app/services/transactions/[id].tsx` | Exists |
| Education bill | `/services/education` | `app/services/education.tsx` | Prototype only via shared static component |

## API Surfaces Used By Mobile App

- Airtime:
  - `GET /services/airtime/networks`
  - `POST /services/airtime/purchase`
- Data:
  - `GET /services/data/networks`
  - `GET /services/data/plans?networkCode=...`
  - `POST /services/data/purchase`
- Electricity:
  - `GET /services/electricity/discos`
  - `POST /services/electricity/validate`
  - `POST /services/electricity/pay`
- Cable TV:
  - `GET /services/cable/providers`
  - `GET /services/cable/packages?providerCode=...`
  - `POST /services/cable/validate`
  - `POST /services/cable/pay`
- Transactions:
  - `GET /transactions`
  - `GET /transactions/:id`
  - `GET /transactions/:id/receipt`
  - `POST /transactions/:id/retry`

## Test Automation Added

- Config: `playwright.config.ts`
- Test command: `npm run test:e2e`
- Specs: `tests/e2e/bills/*.spec.ts`
- Helpers: `tests/e2e/helpers/*.ts`
- Fixtures: `tests/e2e/fixtures/*.ts`

The suite mocks HTTP responses so it can run reliably against Expo Web without live provider credentials. Native iOS/Android gesture, backgrounding, biometric/PIN keyboard, and app reinstall scenarios still require Detox, Maestro, or Appium.
