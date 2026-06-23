# Frontend Admin

Independent admin app extracted from the monolith.

## Run
- `npm --workspace frontend-admin run dev`
- `npm --workspace frontend-admin run build`
- `npm --workspace frontend-admin run type-check`

## Implemented modules
- Admin dashboard (`/admin`)
- Analytics (`/admin/analytics`)
- Competitions overview (`/admin/competitions`)
- Open Mic editions (`/admin/competitions/open-mic`)
- Chat sessions + transcript detail (`/admin/chatbot`, `/admin/chatbot/[id]`)
- Leads queue (`/admin/leads`)
- Handoff queue (`/admin/handoffs`)

## Compatibility bridge
Unmigrated admin routes are handled by `/admin/[[...slug]]`, which provides a link to legacy admin base URL via `NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL`.
