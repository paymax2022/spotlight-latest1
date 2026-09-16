# Go-Live Config — Mobile (React Native / Expo)

How the Paymax x Spotlight mobile app switches from in-app **mocks** to **live**
backends, and how to ship a production bundle that does so.

---

## 1. How Expo env precedence works for this app

Expo only exposes vars prefixed `EXPO_PUBLIC_`. They are **inlined into the JS
bundle at build/bundle time** (`process.env.EXPO_PUBLIC_X`) — not read at
runtime — so you must rebuild to change them.

Load order (later wins), per Expo's dotenv support:

```
.env  <  .env.production (when the build runs in production mode)  <  .env.production.local  <  real shell env vars
```

- Production mode is used by `expo export`, `eas build --profile production`, and
  any `NODE_ENV=production`/`--no-dev` bundle. In that mode `.env.production` is
  loaded; in dev (`expo start`) `.env` is used.
- `.env`, `.env.local`, `.env.*.local` are **git-ignored** (see `.gitignore`).
  `.env.production` is the single source of truth for a live build — keep it out
  of git too if it contains real (public) project values; commit only
  `.env.production.example`.
- A real shell/EAS-secret env var overrides any file. Set
  `EXPO_PUBLIC_API_BASE_URL` etc. as CI/EAS env to avoid committing them.

### The mock switch

Every module's data layer is:

```ts
const USE_MOCK = (process.env.EXPO_PUBLIC_<X>_USE_MOCK ?? 'true') !== 'false';
```

So the default is **mock**, and the flag must be **exactly `false`** (string) to
go live. A missing or misspelled flag silently ships mock data.

---

## 2. Build the production bundle

```bash
cd mobile-app/reactnative
cp .env.production.example .env.production     # then fill CHANGE_ME values
node scripts/check-env-mocks.mjs .env.production   # deploy gate — must pass (all 69 flags)

# Export / build (do NOT run as part of this config task):
npx expo export --platform all        # or:
eas build --profile production --platform all
```

`scripts/check-env-mocks.mjs` derives every `*_USE_MOCK` flag from the source tree and fails the build if any is
missing or not exactly `"false"`. Extend that list if you want to gate more
domains.

---

## 3. Flag reference (one line each)

| Flag | Module / route | Backend path |
|------|----------------|--------------|
| `EXPO_PUBLIC_FX_USE_MOCK` | FX exchange, accounts, virtual cards, FX KYC | `/api/v1/fx` |
| `EXPO_PUBLIC_SAVINGS_USE_MOCK` | Savings | `/api/v1/savings` |
| `EXPO_PUBLIC_SOCIAL_USE_MOCK` | Social Pay | `/api/v1/social` |
| `EXPO_PUBLIC_LOYALTY_USE_MOCK` | Rewards / loyalty | `/api/v1/loyalty` |
| `EXPO_PUBLIC_REFERRAL_USE_MOCK` | Refer & Earn | `/api/v1/referral` |
| `EXPO_PUBLIC_INSURANCE_USE_MOCK` | Protection / insurance | `/api/v1/insurance` |
| `EXPO_PUBLIC_INVEST_USE_MOCK` | Invest landing / eligibility | `/api/v1/invest` |
| `EXPO_PUBLIC_STOCKS_USE_MOCK` | Stocks | `/api/v1/stocks` |
| `EXPO_PUBLIC_ONBOARDING_USE_MOCK` | Invest onboarding | `/api/v1/invest` |
| `EXPO_PUBLIC_SETTINGS_USE_MOCK` | Invest settings | `/api/v1/invest` |
| `EXPO_PUBLIC_AI_USE_MOCK` | Invest AI | `/api/v1/invest` |
| `EXPO_PUBLIC_LEARN_USE_MOCK` | Learn | `/api/v1/academy` |
| `EXPO_PUBLIC_ACADEMY_USE_MOCK` | Academy | `/api/v1/academy` |
| `EXPO_PUBLIC_SPOTLIGHT_USE_MOCK` | Spotlight Wealth | `/api/v1/invest` |
| `EXPO_PUBLIC_FRACTIONALRE_USE_MOCK` | Real Estate Invest | `/api/v1/fractionalre` |
| `EXPO_PUBLIC_CRYPTO_USE_MOCK` | Crypto — **gated by backend `FEATURE_CRYPTO_ENABLED`** | `/api/v1/crypto` |
| `EXPO_PUBLIC_HEALTH_USE_MOCK` | Pharmacy / Lab / Vet hub (incl. symptom search) | `/api/v1/health` |
| `EXPO_PUBLIC_HEALTH_PHARMACY_SYMPTOM_SEARCH` | Pharmacy symptom-based search UI gate — **defaults ON**; must be exactly `true` to show (any other value hides the surface). Backend twin: `FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED` (see §4). Runbook: `docs/health/PHARMACY_SYMPTOM_SEARCH_GOLIVE.md` | `/api/v1/health/pharmacy/symptom-search` |
| `EXPO_PUBLIC_DOCTOR_USE_MOCK` | Telemedicine / doctor | `/api/v1/doctor` |
| `EXPO_PUBLIC_MOBILITY_USE_MOCK` | Ride (per-mode flags fall back to this) — **gated by `FEATURE_TRANSPORT_ENABLED`** | `/api/v1/mobility` |
| `EXPO_PUBLIC_PARCEL_USE_MOCK` | Parcel | `/api/v1/mobility` |
| `EXPO_PUBLIC_BUS_USE_MOCK` | Bus | `/api/v1/mobility` |
| `EXPO_PUBLIC_TOWING_USE_MOCK` | Towing | `/api/v1/mobility` |
| `EXPO_PUBLIC_MOVERS_USE_MOCK` | Movers | `/api/v1/mobility` |
| `EXPO_PUBLIC_CARHIRE_USE_MOCK` | Car hire | `/api/v1/mobility` |
| `EXPO_PUBLIC_LOGISTICS_USE_MOCK` | Logistics | `/api/v1/mobility` |
| `EXPO_PUBLIC_EVENT_USE_MOCK` | Mobility "event" transport mode (**not** Event Tickets) | `/api/v1/mobility` |
| `EXPO_PUBLIC_FOOD_USE_MOCK` | Food (falls back to `RESTAURANT_USE_MOCK`) | `/api/v1/restaurant` |
| `EXPO_PUBLIC_RESTAURANT_USE_MOCK` | Restaurant | `/api/v1/restaurant` |
| `EXPO_PUBLIC_MERCHANT_USE_MOCK` | Merchant onboarding | `/api/v1/onboarding` |
| `EXPO_PUBLIC_CONNECT_USE_MOCK` | Connect | `/api/v1/connect` |
| `EXPO_PUBLIC_CREATORS_USE_MOCK` | Creators | `/api/v1/creators` |
| `EXPO_PUBLIC_EVENTS_USE_MOCK` | Event Tickets | `/api/v1/events` |
| `EXPO_PUBLIC_ASSOCIATION_USE_MOCK` | Associations | `/api/v1/association` |
| `EXPO_PUBLIC_CF_USE_MOCK` | Crowdfunding (+ CSR + extras) | `/api/v1/crowdfunding` |
| `EXPO_PUBLIC_VOTING_USE_MOCK` | Contest / voting / paid votes | `/api/v1/contests`, `/voting` |
| `EXPO_PUBLIC_PROPERTY_USE_MOCK` | Property Mgmt hub | `/api/finance/property` + realtor |
| `EXPO_PUBLIC_PROPERTIES_USE_MOCK` | Owned/occupied properties | `/api/v1/estate` |
| `EXPO_PUBLIC_REALTOR_USE_MOCK` | Realtor marketplace | `/api/v1/realtor` |
| `EXPO_PUBLIC_STAYS_USE_MOCK` | Stays | `/api/v1/stays` |
| `EXPO_PUBLIC_DUES_USE_MOCK` | Estate dues | `/api/v1/estate` |
| `EXPO_PUBLIC_MEETINGS_USE_MOCK` | Estate meetings | `/api/v1/estate` |
| `EXPO_PUBLIC_TASKS_USE_MOCK` | Estate tasks | `/api/v1/estate` |
| `EXPO_PUBLIC_REPAIRS_USE_MOCK` | Estate repairs | `/api/v1/estate` |
| `EXPO_PUBLIC_FACILITIES_USE_MOCK` | Estate facilities | `/api/v1/estate` |
| `EXPO_PUBLIC_ANNOUNCEMENTS_USE_MOCK` | Estate announcements | `/api/v1/estate` |
| `EXPO_PUBLIC_EMERGENCIES_USE_MOCK` | Estate emergencies | `/api/v1/estate` |
| `EXPO_PUBLIC_DOCUMENTS_USE_MOCK` | Estate documents | `/api/v1/estate` |
| `EXPO_PUBLIC_VENDORS_USE_MOCK` | Estate vendors | `/api/v1/estate` |
| `EXPO_PUBLIC_AINOTES_USE_MOCK` | Estate AI notes | `/api/v1/estate` |
| `EXPO_PUBLIC_FINANCE_USE_MOCK` | Estate finance | `/api/v1/estate` |
| `EXPO_PUBLIC_ESTATEADMIN_USE_MOCK` | Estate admin | `/api/v1/estate` |
| `EXPO_PUBLIC_NOTIFICATIONS_USE_MOCK` | Notifications | `/api/v1/notifications` |
| `EXPO_PUBLIC_REPORTS_USE_MOCK` | Estate reports | `/api/v1/estate` |
| `EXPO_PUBLIC_ESTATESETTINGS_USE_MOCK` | Estate settings | `/api/v1/estate` |
| `EXPO_PUBLIC_VISITOR_USE_MOCK` | Visitor / gate | `/api/v1/visitor` |
| `EXPO_PUBLIC_ELECTION_USE_MOCK` | Estate elections | `/api/v1/elections` |
| `EXPO_PUBLIC_ADMIN_USE_MOCK` | Admin console | `/api/v1/admin` |
| `EXPO_PUBLIC_REGISTRATION_USE_MOCK` | Contest register / apply | `/api/v1/contestants` |

Non-mock config vars: `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_MAPS_BASE_URL`,
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL`, `EXPO_PUBLIC_APP_ENV`,
`EXPO_PUBLIC_LOCATIONIQ_TOKEN`. (A few feature/analytics toggles also exist:
`EXPO_PUBLIC_*_ENABLED` mobility-mode toggles, `EXPO_PUBLIC_MOBILITY_DRIVER`,
`EXPO_PUBLIC_MOBILITY_NEGOTIATION`, `EXPO_PUBLIC_HEALTH_PHARMACY_BNPL`,
`EXPO_PUBLIC_*_ANALYTICS_LOG` — leave default unless a feature needs them.)

---

## 4. Backend-gated modules — flip ON the server first

These have a proxy + flag, but the proxy returns nothing useful unless the Go
backend feature flag is on. Set the mobile flag `false` **and** enable the
server flag, or the screen will show offline/empty:

- **Crypto** → backend `FEATURE_CRYPTO_ENABLED=true`.
- **Mobility (all 8 modes)** → backend `FEATURE_TRANSPORT_ENABLED=true` +
  `FEATURE_TRANSPORT_MODES_ENABLED=true`, plus `MAPS_PROVIDER=http` and
  `MAPS_BASE_URL` set.
- **Pharmacy symptom search** → backend `FEATURE_HEALTH_ENABLED=true` +
  `FEATURE_HEALTH_PHARMACY_ENABLED=true` +
  `FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED=true` (all three ANDed). The mobile
  UI gate `EXPO_PUBLIC_HEALTH_PHARMACY_SYMPTOM_SEARCH` defaults ON, so if the
  server flags are off the symptom screens show error/empty states — flip the
  server first, and clear the superintendent-pharmacist sign-off hard gate in
  `docs/health/PHARMACY_SYMPTOM_SEARCH_GOLIVE.md` before doing so.

---

## 5. Checklist to flip a module live

1. **Backend flag on** — confirm any `FEATURE_*_ENABLED` gate for that domain is
   enabled in the production Go backend env.
2. **Proxy exists** — confirm `frontend-web/app/api/v1/<module>/route.ts` (or the
   relevant `/api/finance/*` route) is deployed and reachable from
   `EXPO_PUBLIC_API_BASE_URL`.
3. **Set the flag** — `EXPO_PUBLIC_<X>_USE_MOCK=false` in `.env.production`.
4. **Smoke test** — build, open the module screen, confirm real data loads (no
   "offline"/empty state) and a write path round-trips.

---

## 6. Modules with NO live backend (do not advertise as live)

These appear in `src/constants/modules.ts` (`SERVICE_MODULES`) but have **no
flag and no proxy** — they are already marked `comingSoon: true` and render as
"coming soon", so they are not advertised as live. Leave them as-is:

- **Shopping** (`/services/shopping`)
- **Marketplace** (lifestyle, `/services/marketplace`)
- **Support** (`/services/support`)

Everything else in the grid maps to a flag set to `false` above and an existing
proxy.
