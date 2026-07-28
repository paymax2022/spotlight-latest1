# Spotlight — Auth & Session Model
> Audit date: 2026-06-13

---

## Primary Auth Provider: Supabase Auth

**Service:** Supabase Auth (managed PostgreSQL `auth.users`)  
**Token format:** JWT (HS256), signed by Supabase secret key  
**Session storage:** HTTP-Only cookies (not accessible to JavaScript)  
**Refresh:** Automatic via Supabase client library  

---

## Frontend Session Flow (Next.js middleware)

```
Request hits Next.js middleware
  └── createServerClient(SUPABASE_URL, ANON_KEY, { cookies })
  └── supabase.auth.getUser()   ← validates + refreshes JWT in cookie
  └── if no valid session → redirect /login?next={pathname}
```

**File:** `frontend-web/src/middleware.ts`  
**Token location:** HTTP-Only cookie (Supabase managed — `sb-{project}-auth-token`)  
**Key used:** `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public — cookie signature verification only)

---

## API Route Handler Auth (Next.js route handlers)

```typescript
// File: frontend-web/src/lib/auth/request.ts
export async function requireRequestUser(request: Request): Promise<RequestUser> {
  const token = request.headers.get('authorization')?.slice(7) ?? '';
  if (!token) throw new Error('UNAUTHORIZED');
  const supabase = createAdminClient();            // ← uses SUPABASE_SERVICE_ROLE_KEY
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHORIZED');
  return { id: data.user.id, email: data.user.email };
}
```

**Flow:** Client sends JWT as `Authorization: Bearer {token}` from its cookie session  
**Verification:** Admin client (service_role) validates JWT signature  
**⚠️ RISK:** service_role key used for auth verification; if it leaks, all JWT verification can be forged

---

## Admin Role Check (Next.js)

```typescript
// File: frontend-web/src/lib/auth/server.ts
async function requireAdmin() {
  const user = await requireUser();
  // Check 1: user_profiles.role column
  const profile = await supabase.from('user_profiles').select('role').eq('id', user.id).single();
  // Check 2: JWT metadata fallback
  if (!profile || profile.role !== 'admin') {
    const role = user.user_metadata?.role || user.app_metadata?.role;
    if (role !== 'admin') throw new Error('FORBIDDEN');
  }
}
```

**⚠️ RISK:** Dual check (DB + JWT metadata) can become out of sync. JWT metadata is cached; a role revocation in DB may not immediately invalidate an outstanding JWT.

---

## Backend Auth Flow (Go/Gin)

```
Request → CORSMiddleware → RequireAuthContext(supabase, rbacService)
  └── Extract JWT from Authorization: Bearer {token}
  └── supabase.auth.getUser(token)     ← cryptographic JWT verification
  └── Load user_roles + effective_permissions from RBACService
  └── Store in gin.Context
  └── → Handler
        └── RequirePermission(rbacService, "permission.slug")
              └── effective_permissions() RPC → check slug present
```

**File:** `backend/internal/middleware/auth_context.go`  
**Key used:** Supabase JWT secret (not service_role — proper verification)

---

## RBAC Enforcement Layers

| Layer | Mechanism | Location |
|---|---|---|
| Frontend page guard | Middleware redirect to /login | src/middleware.ts |
| Frontend component | requireAdmin() / requireJudgeOrAdmin() | src/lib/auth/server.ts |
| Backend route | RequireAuthContext + RequirePermission | backend/internal/middleware/ |
| Backend admin dashboard | RequireAdmin(apiKey) — shared secret | backend/internal/middleware/admin_auth.go |
| Database | RLS policies scoped to auth.uid() | Supabase |
| RPC | user_has_permission() checks before sensitive ops | supabase/migrations/20260527100000 |

---

## Role Determination

| Source | Field | Who uses it |
|---|---|---|
| auth.users.app_metadata.role | `admin`, `judge`, etc. | Frontend fallback; set at signup |
| user_profiles.role (if column exists) | Same values | Frontend primary check |
| public.user_roles | Scoped role assignments | Backend RBAC; effective_permissions() |
| platform_users.user_type | 'registered_user' etc. | ⚠️ Parallel system; unclear usage |

---

## Session Object Structure

```typescript
{
  access_token: string,    // JWT (short-lived, ~1h)
  refresh_token: string,   // Long-lived; used to get new access_token
  expires_in: number,      // Seconds until access_token expiry
  expires_at: number,      // Unix timestamp
  token_type: 'Bearer',
  user: {
    id: string,            // uuid — FK to all tables
    email: string,
    user_metadata: { full_name, role, ... },
    app_metadata: { role, roles: [...] }
  }
}
```

---

## Admin Dashboard Auth (Internal)

**Route group:** `/api/v1/admin/*`  
**Method:** HTTP header `x-admin-api-key: {SPOTLIGHT_ADMIN_API_KEY}`  
**Value:** Random hex string from `openssl rand -hex 32`  
**⚠️ Risk:** Shared static secret; no per-user audit trail; rotation requires redeploy  
**Migration path:** Replace with JWT + RequirePermission("admin.dashboard.access")

---

## Gaps for Fintech Build

| Gap | Severity | Required Fix |
|---|---|---|
| No step-up auth for sensitive ops (withdrawals, credential changes) | CRITICAL | Add PIN/OTP step-up before fintech mutations |
| JWT role claim can be stale after role revocation | HIGH | Add short TTL or per-request DB role check for financial ops |
| platform_users parallel identity system | HIGH | Deprecate; consolidate to Supabase Auth + user_profiles |
| No device binding | MEDIUM | Track auth device fingerprint; alert on new device |
| No 2FA for staff | HIGH | PRD requires mandatory 2FA for finance/compliance roles |
| No phone verification on user_profiles | HIGH | Phone is identity anchor for KYC tier 1 |
| service_role key used for token verification | MEDIUM | Use Supabase JWT verification endpoint instead |
