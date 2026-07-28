# Association module — Go-live runbook

The mobile Association module ships **mock-first**. Every screen reads through a
React Query hook → a `*.api.ts` wrapper that branches on `USE_MOCK`. Flipping one
env var switches the whole module to the live backend.

## 1. Flip the switch
```
# mobile-app/reactnative/.env
EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false
EXPO_PUBLIC_API_BASE_URL=https://<your-api-host>   # serves the /associations paths
```
`USE_MOCK` is defined in `src/features/association/constants/association.constants.ts`
and defaults to mock when the var is unset.

## 2. Implement the contract
Source of truth: **`contracts/associations.openapi.yaml`** (68 paths / 76 operations).
Bare paths are served at the API base URL exactly as the client calls them, e.g.
`GET /associations/me/dashboard`. Conventions:
- Supabase **Bearer JWT** on every request.
- **`Idempotency-Key`** header on every POST/PUT/PATCH/DELETE (already sent by the
  client for money + apply + admin mutations).
- All money is **kobo** (integer minor units).

## 3. Apply the schema
`supabase/migrations/20260628000000_association_module.sql` — 29 additive tables
(`assoc_*`), additive-only (safe to apply ahead of rollout):
```
supabase db push
```
Money path: `assoc_payments` carries `ledger_txn_id` + a unique idempotency index;
dues payments and offline-payment approvals must post **balanced double-entry
ledger** rows and an `assoc_audit_log` event (never mutate a balance column).

## 4. Endpoint inventory (68)
Grouped by area; ⚑ = money/sensitive (must audit-log + idempotency):

- **Discovery/Join:** `GET /associations`, `GET /associations/{id}`,
  `POST /associations/invites/validate`, `POST /associations/access-codes/validate`,
  `POST /associations/members/apply`.
- **Member self:** `GET /associations/me/{dashboard,card,profile,privacy,activity,dues,admin-access,notification-prefs,security,devices}`,
  `PUT /associations/me/{profile,privacy,notification-prefs,security}`,
  `DELETE /associations/me/devices/{id}`.
- **Directory:** `GET /associations/members`, `GET /associations/members/{id}`.
- **Dues ⚑:** `POST /associations/dues/{invoiceId}/pay`, `GET /associations/receipts/{id}`.
- **Engagement:** announcements (`GET` list/detail, `POST .../acknowledge`),
  notifications (`GET`, `POST /read`).
- **Meetings:** `GET` list/detail, `POST .../rsvp`, `POST .../attendance`.
- **Tasks:** `GET` list/detail, `PATCH /{id}`.
- **Documents:** `GET` list/detail, `POST .../acknowledge`.
- **Chat:** `GET` threads/thread, `POST .../messages ⚑`.
- **AI notes:** `GET` list/detail/status, `POST` create/approve/publish/convert ⚑.
- **Community:** committees (`GET` list/detail, `POST .../join`),
  events (`GET` list/detail, `POST .../rsvp,/register ⚑,/feedback`).
- **Support:** faqs, tickets (`GET` list/detail, `POST` create/reply).
- **Admin ⚑:** kpis, approvals (`GET` queue/detail, `POST .../decision`),
  finance (summary, offline list, `POST .../decision`), import (preview/confirm),
  member actions (suspend/restore/transfer/role), `POST /associations` (publish org).

## 5. RBAC
`GET /associations/me/admin-access` returns the caller's role + capability flags
(`approveMembers`, `manageMembers`, `manageFinance`, `importMembers`). The app
already gates the admin console, the admin entry on the dashboard, and per-action
controls on these flags — return real values from the backend.

## 6. Verify
- `python -c "import yaml; yaml.safe_load(open('contracts/associations.openapi.yaml'))"` (CI: swagger-cli validate).
- Additive-only guard: the migration contains no DROP/rename/narrowing.
- `npx tsc -p tsconfig.assoccheck.json --noEmit` (0 errors) on an unloaded machine.
- e2e: register → approve → pay dues → card active → vote eligibility restored.
