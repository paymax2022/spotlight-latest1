# Round 2 QA — RBAC / config / wiring fix verification

**Scope:** Static re-test (documentation only, no code changed) of the six just-applied
RBAC/config/wiring fixes, plus a fresh full enforced-vs-seeded permission-slug reconciliation.

**Method:** Read the changed files; re-swept every `RequirePermission` / `RequireScopedPermission`
call site across `backend/internal` (resolving permission constants and `guard()/rp()` helper
wrappers to their literal slug strings); extracted every slug seeded into `public.permissions`
across all `supabase/migrations/*.sql` with a SQL-aware parser (comment-stripping + string-literal-aware
statement splitting — naive regex is unsafe because several seed descriptions contain `;` and `)`);
then diffed the two sets. RBAC match semantics confirmed as **exact string equality**
(`public.user_has_permission` → `effective_permissions.permission_slug = p_permission_slug`,
`20260527100000_enterprise_auth_rbac.sql`; middleware passes the slug verbatim to
`CheckPermission`, `backend/internal/middleware/authorization.go:17`). No wildcard/prefix matching
exists, so a slug is satisfiable only if seeded verbatim.

---

## 1. Verification checklist

| # | Fix | Verdict | Evidence |
|---|-----|---------|----------|
| 1 | RBAC seed gap (6 perms) | **PASS** | `20260920000100_rbac_seed_gaps.sql` INSERTs all 6 slugs into `public.permissions` `ON CONFLICT (slug) DO NOTHING` (L44-52), grants each to `super-admin` (L54-68) and `system-admin` (L70-84), plus `restaurant.admin.pricing`→`restaurant-ops` (L86-91, guarded by `WHERE EXISTS`) and `learn.admin.manage`→`platform-edtech-admin` (L93-98, `WHERE EXISTS`), all `ON CONFLICT DO NOTHING`. Slug strings match the enforcement sites exactly (see below). |
| 2 | Tier limits default true | **PASS** | `config.go:522` — `FeatureTierLimitsEnabled: getEnvBool("FEATURE_TIER_LIMITS_ENABLED", true)`. Comment cites go-live blocker #1. |
| 3 | Promotion routes gated | **PASS** | `promotion/handler.go` L106-111: `teacher-approval`, `admin-approval`, `apply` all call `middleware.RequirePermission(rbac, "academy.fees.promotion.approve")`. Member routes (`scores`, `compute`, `GET promotion`) stay ungated (L99-101). `middleware` imported (L10). Slug `academy.fees.promotion.approve` is seeded. |
| 4 | Mobile `amountMinor` | **PASS** | `academy/fees/api.ts` — `payInvoice` POSTs `{ amountMinor: amountKobo }` (L387) to `/invoices/:id/payments`; `fundVault` POSTs `{ amountMinor: amountKobo }` (L524) to `/vaults/:id/contribute`. Matches backend `RecordPaymentRequest.AmountMinor` / `ContributeRequest.AmountMinor` json tags. `Idempotency-Key` header sent on both. |
| 5 | Restaurant order 400 | **PASS** | `restaurant/handler.go PlaceOrder` L48-50 reads `Idempotency-Key` from header, body field is fallback, fail-closed 400 if empty (L51-54). L58-68 normalizes each item via `MenuItem()`/`QtyOf()`. `model.go`: `PlaceOrderRequest.IdempotencyKey` has no `binding:"required"` (L113); `OrderItemInput` accepts both `menu_item_id`/`item_id` and `quantity`/`qty` with `MenuItem()`/`QtyOf()` normalizers (L145-168). |
| 6 | Connect card normalize | **PASS** | `connect/discovery/api.ts` — `normalizeVerified` maps bool→`['identity']` / else `[]` (L70-76); `normalizeProfile` defaults `photos`/`interests`/`prompts` to `[]` (L87-89); `unwrapProfiles` maps every live card through `normalizeProfile` (L104-110); stack + nearby + likes-you use `unwrapProfiles`. `stack.tsx` guards `current.photos?.[0]` (L171), `current.verified ?? []` (L188), `current.prompts?.[0]` (L189). |

**No new breakage introduced by the fixes:** promotion handler imports `middleware` (needed for the new
gate); `config.go` change is a single default flip inside the existing `getEnvBool` pattern (parses fine);
restaurant model/handler additions are self-consistent. Go toolchain was unavailable in the sandbox, so
`go build`/`go vet` could not be executed — this is a static-read verdict.

---

## 2. Complete enforced-but-unseeded reconciliation (KEY DELIVERABLE)

Enforced permission slugs (real `RequirePermission`/`RequireScopedPermission`/`guard()`/`rp()` call sites,
constants resolved): **201**. Seeded slugs (`public.permissions` INSERTs across all migrations): **291**.

### Comment-only slugs EXCLUDED from the enforced set (not real gaps)
Four `.*` "wildcard" slug strings appear **only in doc comments** telling the integration task which slug to
use — they are NOT arguments to any real `RequirePermission` call, and the actual routes are gated by concrete
slugs at the wiring layer (`app/academy_routes.go`, `transport`). Excluded correctly:
`academy.fees.export.*` (real gate: `academy.fees.export.run`), `academy.fees.scholarship.*` (member
self-service, no admin gate wired yet), `academy.fees.trustscore.*` (real gate: `academy.fees.trustscore.view`),
`transport.admin.scheduled.*` (real gates: `transport.admin.scheduled.{cancel,read,reassign}`).

### The 6 previously-fixed slugs are now correctly seeded (regression clean)
`finance.admin.transfers`, `finance.admin.kyc`, `restaurant.admin.pricing`, `spotlight.admin.manage`,
`learn.admin.manage`, `maps:metrics:read` — all confirmed present in `public.permissions` via
`20260920000100_rbac_seed_gaps.sql`. No longer unseeded.

### STILL enforced-but-unseeded — 7 slugs (FULL LIST)

| Slug | Enforcement site | Notes |
|------|------------------|-------|
| `academy.assessment.review` | `academy/assessment/handler.go:72` `guard(...)` on `POST /items/:id/transition` | Only `academy.assessment` (no `.review`) is seeded — sibling-slug mismatch. |
| `academy.identity` | `academy/identity/handler.go:45-46` `guard(...)` on `GET /admin/users/:id`, `POST /admin/guardians/:id/revoke` | Appears in migration comments only; no permission row. |
| `connect.moderation.manage` | `app/connect_safety_routes.go:84,87` `RequirePermission(...)` | Only `connect.moderation.review` and `connect.moderation.view` are seeded — `.manage` variant never seeded. (`connect.moderation.decision` is an audit-event name, not a permission — not a gap.) |
| `placement.admin.approve` | `app/placement_routes.go:79` | No `placement.admin.*` permission is seeded in any migration. |
| `placement.admin.reject` | `app/placement_routes.go:80` | idem — entire placement admin RBAC surface unseeded. |
| `placement.admin.review` | `app/placement_routes.go:77,78,81` | idem. |
| `placement.admin.suspend` | `app/placement_routes.go:82` | idem. |

**Impact (same failure mode as the original 6):** every one of these routes 403s for every non-`super-admin`
operator, because `user_has_permission` hard-returns TRUE only for `super-admin` and the permission row does
not exist to grant to any operator role. Feature-flag gating limits blast radius (placement behind
`FEATURE_PLACEMENT_ENABLED`, academy behind its module flags, connect safety behind `FEATURE_CONNECT_ENABLED`),
but wherever the module is enabled these consoles are unusable except as super-admin.

**Recommended follow-up (Round 3):** a second additive `ON CONFLICT DO NOTHING` seed migration for these 7
slugs (module/resource/action parsed from each slug), granting to `super-admin` + `system-admin` and the
appropriate operator role (placement → an ads/placement-ops role if one is introduced; academy.identity /
academy.assessment.review → `platform-edtech-admin`; connect.moderation.manage → the connect moderation
operator role). Also decide whether `academy.assessment.review` should collapse to the seeded
`academy.assessment` or be seeded as a distinct slug.
