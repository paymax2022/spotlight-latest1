---
name: project-auth-gaps
description: Auth security gaps found and fixed on 2026-06-02 — keep these in mind for all future API work
metadata:
  type: feedback
---

Fixed on 2026-06-02. Keep these rules when writing any new API routes.

**Why:** Admin routes had zero real auth — x-admin-role header was trusted without JWT; API key defaulted to "allow all" if env var unset. Votes API had no auth. Server Supabase client never read cookies.

**How to apply:** All new API routes must follow these patterns:

1. Admin routes → `await assertAdminPermission(request, 'permission:name')` (async, validates JWT first)
2. User routes → `await requireRequestUser(request)` (requires Bearer token)
3. Voting → free votes are semi-public (no hard login required) but fraud-scored; paid votes require email
4. SPOTLIGHT_ADMIN_API_KEY must be set in `.env` — add it to every environment
5. Never trust `x-admin-role` header alone (it's only honoured after JWT or API key verification)
6. Server Supabase client (`src/lib/supabase/server.ts`) now uses @supabase/ssr + cookies() — use `createClient()` (async) for user-context, `createAdminClient()` (sync) for service-role operations
