---
name: fintech-build-state
description: Current state of the Paymax x Spotlight super-app build — all 22+ blocks complete, all tests passing
metadata:
  type: project
---

## Build status: ~35% of full production estate system as of 2026-06-18

### Completed blocks 0–22 + Health Premium (all in Go backend + mobile)

| Block | Description | Status |
|---|---|---|
| 0 | Golden-path E2E baseline | ✅ |
| 1 | Platform scaffold + feature flags + openapi.yaml | ✅ |
| 2 | KYC schema + state machine | ✅ |
| 3 | Double-entry ledger schema | ✅ |
| 4 | Wallet service | ✅ |
| 5 | Paystack DVA provisioning | ✅ |
| 6 | Vote bridge (idempotent, KYC gate, outbox) | ✅ |
| 7 | Per-tier daily limits (atomic debit RPC) | ✅ |
| 8 | Referrals (at-most-once) | ✅ |
| 9 | Fintech admin RBAC (maker-checker) | ✅ |
| 10 | Wallet-to-wallet transfer | ✅ |
| 11 | Wallet-to-bank transfer | ✅ |
| 12 | Beneficiary management | ✅ |
| 13 | Telemedicine booking & settlement (Health Premium) | ✅ |
| 14 | Transport (ride-hailing) | ✅ |
| 15 | Restaurant delivery | ✅ |
| 16 | Estate management | ✅ |
| 17 | Crowdfunding | ✅ |
| 18 | Events & ticketing | ✅ |
| 19 | Group savings (Ajo/Esusu) | ✅ |
| 20 | AI Care (async health AI) | ✅ |
| 21 | Ratings | ✅ |
| 22 | Disputes | ✅ |
| — | Pharmacy (product catalogue + cart) | ✅ |

**Backend tests: `go test ./...` — all packages pass. 326+ frontend tests green.**

### Test coverage gaps (not blocking, but noted)
- `platform/db`, `platform/queue`, `platform/redis`, `platform/ws` — no unit tests (integration-only)
- `repositories`, `integrations` — no test files

### Doctor module + Agora vector (done 2026-06-23)
- `backend/internal/doctor/` — full build/vet/test ✅ (all 17 tests PASS)
- `backend/internal/integrations/rtc/` — `TestAgoraKnownAnswer` certified ✅
  - Vector: `007eJxSYNiRu5qp6O5yY/ZkhqaLiWEX...` (byte-for-byte match vs official Agora SDK v0.0.0-20250825033728)
- `contracts/doctor.openapi.yaml` — YAML valid ✅
- Mobile `tsconfig.doctorcheck.json` scoped typecheck ✅; whole-app typecheck ✅
  - Fixed: `Colors.gradient*` typed as `string[]` → typed tuples `[string,string]` / `[string,string,string]`
- doctor-ci.yml pushed on `feat/tiers-and-limits` → CI triggered 2026-06-23
- No runtime secrets needed in CI (all unit tests, credentials default `""`)

### Merchant Onboarding vertical (code complete 2026-06-23, execution pending)
- Feature flag: `FEATURE_ONBOARDING_ENABLED` (default false) — wired at `finance_routes.go:761` ✅
- Migration `20260619000000_merchant_onboarding.sql` — DDL guard clean (no DROP/RENAME) ✅
- Mock-vs-live flags flipped to live in both `.env.example` files ✅
- `go build ./...` + `go vet ./...` — clean ✅
- Runbook: `docs/merchant-onboarding-golive.md` — complete, commands in dependency order
- **Remaining (needs real box):**
  1. `supabase db push` — migration not applied to cloud DB yet (requires human confirmation)
  2. Three-terminal stack start + E2E happy path (approve→role-grant scenario in runbook §4)

### Block 23 — Estate mobile UI (done 2026-06-18)
- `apps/mobile-starter/src/api/estate.api.ts` ✅
- `apps/mobile-starter/app/(protected)/estate/index.tsx` — hub screen ✅
- `apps/mobile-starter/app/(protected)/estate/passes.tsx` — visitor passes + QR ✅
- `apps/mobile-starter/app/(protected)/estate/elections.tsx` — elections + vote ✅
- Estate tile added to home grid and More → Marketplace ✅
- API base path: `/api/finance/estate/...`

### Blocks 24–46 — Estate Production System (planned, not yet built)
Full production estate management system added to playbook 2026-06-18. 23 blocks covering:
B. Estate onboarding & property selection (Block 24)
C. Resident profiles (Block 25)
D. Home dashboard (Block 26)
E. Extended visitor access codes (Block 27)
F. Security guard app (Block 28)
G. Property management (Block 29)
H+I. Dues, rent, subscription payments, restrictions (Block 30)
J. Elections extended (Block 31)
K. Meetings (Block 32)
L. AI note-taking via Claude claude-sonnet-4-6 (Block 33)
M. Tasks (Block 34)
N. Repairs & maintenance (Block 35)
O. Facility booking (Block 36)
P. Announcements & community (Block 37)
Q. Emergency & incidents (Block 38)
R. Documents (Block 39)
S. Estate finance & wallet (Block 40)
T+U. Admin panel + landlord (Block 41)
V. Vendor / contractor app (Block 42)
W. Notifications (Block 43)
X. Analytics (Block 44)
Y. Settings (Block 45)
Z. Empty/error states (Block 46)

### Mobile screens (Expo Router, pre-estate)
All 3 Stitch projects fully implemented:
- Project 8079403111503223543 — Paymax Super Marketplace (14 screens)
- Project 8398189927219025768 — Premium Event Management Suite (4 screens)
- Project 273667085870544349 — Paymax Health Premium Ecosystem (11 screens + pharmacy)

### Admin dashboard (`frontend-admin/`)
- Finance hub page + KYC queue + Wallet lookup + Disputes — **fully implemented**
- AdminSidebar Finance section — **fixed (was missing from sections array)**
- TypeScript `tsc --noEmit` — clean (after `@supabase/supabase-js` install)

### OpenAPI (`contracts/openapi.yaml`)
All endpoints documented including new:
- `/telemedicine/specialties`, `/telemedicine/doctors/{id}`, `/telemedicine/appointments` (GET+POST)
- `/telemedicine/doctor/register|dashboard|availability|notes|licence`
- `/pharmacy/products`, `/pharmacy/cart` (GET+POST+DELETE), `/pharmacy/cart/{product_id}` (PATCH+DELETE)
- Schemas: `DoctorProfile`, `ConsultationSpecialty`, `DoctorDashboard`, `SOAPNote`, `PharmacyProduct`, `CartItem`

### Route architecture
- Go backend: `/api/finance/...` (legacy) + `/api/v1/telemedicine/...` + `/api/v1/pharmacy/...` (mobile-facing)
- Mobile client calls: `/api/v1/telemedicine/...` and `/api/v1/pharmacy/...`

## Critical constraints (always apply)
- All money amounts: BIGINT kobo, never float
- Idempotency-Key required on every money mutation
- Ledger entries: immutable (INSERT only, no UPDATE/DELETE)
- Balance = projection of ledger, never stored directly
- Fail-closed: tier/balance checks block on any error
- Feature-flag every module (env var, default false)
- All new FKs → auth.users(id)
- Additive DB migrations only
- Never edit protected legacy Spotlight files
- Go router: Gin v1.10 (never Chi)
- pgx for money-path DB access; Supabase REST for Spotlight modules
