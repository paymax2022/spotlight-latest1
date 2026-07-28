# Estate Super-App — Blocks 29–47 Roadmap

19 estate feature blocks, built full-stack with the conventions established by the
Visitor/Election modules: **additive migration → `/api/v1` handlers → mobile
`features/<module>` + `app/<group>` screens (dual mock/live behind `USE_MOCK`)**.
Money in kobo; mutations idempotency-keyed + audited; additive-only migrations;
estate-scoped RLS.

Blocks 27–28 (visitor) and elections are already done. Blocks 29–47 below.

| Block | Domain | Tables (new) | Status |
|---|---|---|---|
| 29 | Dues / Rent / Subscriptions | `estate_dues_invoices`, `estate_payments` | schema ✅ |
| 30 | Meetings | `estate_meetings`, `meeting_rsvps`, `meeting_minutes` | **DONE** — schema ✅ · mobile ✅ · handlers ✅ (list/create/[id]/rsvp/minutes) |
| 31 | Tasks | `estate_tasks` | schema ✅ |
| 32 | Maintenance / Repairs | `estate_repair_requests`, `repair_updates` | schema ✅ |
| 33 | Facilities / Amenities | `estate_facilities`, `facility_bookings` | schema ✅ |
| 34 | Announcements / Comms | `estate_announcements`, `announcement_reads` | schema ✅ |
| 35 | Emergencies / Incidents | `estate_emergency_alerts` | schema ✅ |
| 36 | Documents | `estate_documents` | schema ✅ |
| 37 | Vendors / Artisans | `estate_vendors`, `vendor_jobs` | schema ✅ |
| 38 | Property management | (reuses `estate_properties`, `property_ownership_claims`) | existing |
| 39 | AI note-taking | (reuses association `ai_notes`) | existing |
| 40 | Finance dashboard | (derived from 29/32/33 + ledger) | aggregate |
| 41 | Admin panel | (existing tables + RBAC; admin web) | cross-cut |
| 42 | Vendor app | (Block 37 `vendor_jobs`) | UI |
| 43 | Notifications | (per-module + `visitor_notifications`/announcements) | cross-cut |
| 44 | Reports & analytics | (derived aggregates) | aggregate |
| 45 | Settings | (config/profile; no core tables) | UI |
| 46 | Empty / error / edge states | (shared `StateView`) | UI |
| 47 | Production hardening | (CI, RLS audit, indexes, idempotency, ops) | ops |

## Sequencing
1. **Block 29–37 schema** — one additive migration (`20260622010000_estate_modules.sql`). ← this turn
2. Per block: `/api/v1/estate/<domain>` handlers (Supabase-direct, mirroring the election/visitor handlers) → mobile `features/<domain>` data layer + hooks → screens.
3. Aggregate/cross-cut blocks (40, 41, 43, 44) build on the domain tables.
4. Block 47 hardening: extend the visitor-election CI workflow, RLS/index review, money-path tests.

## Conventions (per the Visitor module, already proven)
- Mobile: `src/features/<domain>/{types,constants,utils,api,hooks,components}` + `app/<group>` screens; module-scoped color constants; reuse `ScreenHeader`/`StateView`/`PrimaryButton`/`TextInputField`/`SelectField`/`MetricBar`.
- API: `<DOMAIN>_USE_MOCK` flag; live path via `@/api/client` to `/api/v1/...`; `Idempotency-Key` on mutations.
- Backend: `requireRequestUser` + `createAdminClient`, estate-scoped, raw `NextResponse.json` shapes matching the mobile contract.
