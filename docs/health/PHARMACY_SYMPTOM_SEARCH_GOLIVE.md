# Pharmacy Symptom Search — Go-Live Runbook

Production go-live procedure for the **Pharmacy Symptom-Based Medication Search addon**
(symptom-guided product discovery — NOT diagnosis, NOT prescribing).

References: PRD `docs/health/Pharmacy_Symptom_Search_Addon_PRD.md` · ADR
`docs/adr/ADR-016-pharmacy-symptom-search.md` · wiring
`backend/internal/app/health_symptom_routes.go` · engine
`backend/internal/health/symptomsearch/` · console
`frontend-admin/app/admin/health/{pharmacy-reviews,symptom-mappings}/` · mobile
`mobile-app/reactnative/app/health/pharmacy/symptom/`.

---

## 0. Hard gates — do NOT flip the flag without these

**Superintendent pharmacist sign-off is a blocking prerequisite** (PRD closing
constraint: "Superintendent pharmacist sign-off required on §4 taxonomy and §5
gating rules before build" — and, per migration `20260829000000` header, before
`FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED` is turned on in production).

Required sign-off artifacts (all three, filed together — this bundle is the
answer to any future PCN query):

1. **Signed sign-off record** — a dated document naming the superintendent
   pharmacist of record (name + PCN registration number), stating that the
   **APPROVED core taxonomy pack** (PRD §4: terms → concepts → clusters →
   cluster rules → therapeutic classes → class maps, as seeded by migrations
   `20260827000000` and `20260829000000`) and the **gating rules** (PRD §5:
   POM/BLOCKED_ONLINE never surfaced, tier escalations, cohort suppressions,
   antibiotic/antimicrobial hard exclusion) have been clinically reviewed and
   approved. Store under `docs/health/signoffs/` (or the compliance vault) with
   the exact migration filenames covered.
2. **`approved_by` back-fill** — system seeds carry `approved_by = NULL`
   (the CHECK is satisfied by `approved_at`). At sign-off, back-fill the
   superintendent's `auth.users` id onto every seeded APPROVED row so the
   decision chain is human-accountable in the database, not just on paper:

   ```sql
   -- run once, with the superintendent's user id
   UPDATE public.symptom_concepts        SET approved_by = '<superintendent-uuid>' WHERE status = 'APPROVED' AND approved_by IS NULL;
   UPDATE public.symptom_terms           SET approved_by = '<superintendent-uuid>' WHERE status = 'APPROVED' AND approved_by IS NULL;
   UPDATE public.symptom_clusters        SET approved_by = '<superintendent-uuid>' WHERE status = 'APPROVED' AND approved_by IS NULL;
   UPDATE public.therapeutic_classes     SET approved_by = '<superintendent-uuid>' WHERE status = 'APPROVED' AND approved_by IS NULL;
   ```
3. **Versioned taxonomy export** — a point-in-time export (CSV or SQL dump) of
   all APPROVED taxonomy rows attached to the sign-off record, so the exact
   approved content is frozen alongside the signature.

Also required before go-live (standard gates):

- `npm run test:regression` green before and after the change.
- `cd backend && go build ./... && go vet ./...` clean.
- Pharmacist review rota staffed for the SLA window (see §7 / Known limitations).

---

## 1. Migrations — order matters

Four additive-only migrations, applied **in this order**:

| # | Migration | What it does |
|---|-----------|--------------|
| 1 | `20260827000000_pharmacy_symptom_search.sql` | Full schema (taxonomy tables, `pharmacy_skus`, `pharmacy_review_cases`, `symptom_search_events`, disclaimer versions), RLS, RBAC permissions, 10-concept starter seed |
| 2 | `20260828000000_pharmacy_symptom_order_link.sql` | `pharmacy_review_case_events` (evented state history), order ↔ search-event FK links, resolution snapshot columns |
| 3 | `20260829000000_pharmacy_symptom_taxonomy_v1.sql` | Phase-1 taxonomy expansion (60 concepts / ~320 terms / 25 clusters / 14 classes); Hausa/Yoruba/Igbo packs seeded **AI_SUGGESTED** (not user-visible) |
| 4 | `20260830000000_pharmacy_symptom_hardening.sql` | Go-live hardening: `pharmacy_skus.qty_window_days` (per-SKU rolling cap window, default 30 d) + cap/metrics indexes, and the `pharmacy_symptom_events_purge()` NDPR purge function (SECURITY DEFINER, service_role-only EXECUTE) |

House rule (local-first Supabase): **local/dev applies with
`supabase migration up`** (or `supabase db reset` to replay); **`supabase db
push` is reserved for the actual go-live** against the production project.

```bash
# local / staging verification
supabase migration up          # applies pending, in timestamp order
# production, at go-live only
supabase db push
```

All four are idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`) and
contain no DROP/rename — safe to re-run, safe to leave applied while the
feature flag stays off.

---

## 2. Env matrix

### Backend (Go)

> ⚠ The Go backend does **NOT** self-load `.env` — export vars in the shell,
> systemd `EnvironmentFile`, or the container env. And remember: **dev runs on
> port 8091** (8080 is a decoy that 503s everything).

| Var | Go-live value | Notes |
|-----|---------------|-------|
| `FEATURE_HEALTH_ENABLED` | `true` | Health platform root gate |
| `FEATURE_HEALTH_PHARMACY_ENABLED` | `true` | Pharmacy vertical gate |
| `FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED` | `true` | The addon flag. **AND**ed with both flags above — all three must be true (`finance_routes.go`) |

Optional backend env:

| Var | Default | Notes |
|-----|---------|-------|
| `SYMPTOM_EVENTS_RETENTION_DAYS` | `180` | NDPR retention window for `symptom_search_events`. Purge is **automated**: `symptomsearch.StartRetentionPurge` runs the `pharmacy_symptom_events_purge()` SQL function at backend startup and every 24 h thereafter (background ticker, house pattern) |

The per-user+device rate limit (20 req/min,
`symptomsearch.PerUserDeviceRateLimit(rdb, 20, time.Minute)`) needs no
dedicated env: when `REDIS_URL` is configured (it already is for the platform)
the limiter is **Redis-backed and holds across backend instances**; with no
Redis it falls back to in-memory per-instance. The device-hash salt is a code
constant.

### Mobile (React Native / Expo) — rebuild required to change

| Var | Go-live value | Notes |
|-----|---------------|-------|
| `EXPO_PUBLIC_HEALTH_PHARMACY_SYMPTOM_SEARCH` | `true` | UI gate for the symptom surface. Defaults **on**; any value other than the string `true` hides it (`src/features/health/api/symptomSearch.api.ts`) |
| `EXPO_PUBLIC_HEALTH_USE_MOCK` | `false` | Must be exactly the string `false` or the whole Health hub (pharmacy included) ships mock data |

Traffic path: mobile → frontend-web proxy `/api/v1/health/pharmacy/symptom-search`
→ Go `/api/finance/health/pharmacy/symptom-search`. The proxy forwards
`X-Device-Id` (rate-limit dimension) and `Idempotency-Key` verbatim.

### Admin console (Next.js, :3001/admin)

| Var | Go-live value | Notes |
|-----|---------------|-------|
| `NEXT_PUBLIC_HEALTH_USE_MOCK` | `false` | Flips `pharmacySymptomAdminService` (reviews + mappings + metrics) to the live Go backend |
| `NEXT_PUBLIC_ADMIN_API_BASE_URL` | `https://<api-host>/api/v1` | Admin base; the service swaps the `/api/v1` suffix for `/api/health/pharmacy/admin` |

---

## 3. RBAC — pharmacist account grants

Migration `20260827000000` seeds two permissions and grants them **only to
`super-admin` and `system-admin`**:

- `health.pharmacy.symptom.mappings` — taxonomy suggest-approve CRUD
  (SUPERINTENDENT-grade; holding it also unlocks **cross-tenant** review
  decisions via the `isSuperintendent` override in `health_symptom_routes.go`)
- `health.pharmacy.symptom.reviews` — review-case decisions, object-level
  authz scoped to the pharmacist's premises tenant

Working pharmacists get access through the standard RBAC tables
(`roles` / `permissions` / `role_permissions` / `user_roles`, from
`20260527100000_enterprise_auth_rbac.sql`). Recommended: grant the **reviews**
permission to the existing `health-provider-pharmacist` role (seeded by
`20260815000100_health_platform.sql`) and assign that role to each pharmacist:

```sql
-- one-time: reviews permission → pharmacist role
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.slug = 'health-provider-pharmacist'
  AND p.slug = 'health.pharmacy.symptom.reviews'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- per pharmacist: assign the role
INSERT INTO public.user_roles (user_id, role_id)
SELECT '<pharmacist-uuid>', id FROM public.roles WHERE slug = 'health-provider-pharmacist'
ON CONFLICT DO NOTHING;
```

**Do NOT** bulk-grant `health.pharmacy.symptom.mappings` — it is the
superintendent capability (taxonomy goes live on approval, and it overrides
tenant scoping on reviews). Grant it to the superintendent's account only,
either directly per-user or via a dedicated role.

The admin console sidebar/UI gates on the same slugs (convenience only); the
Go backend enforces per-route `RequirePermission` regardless.

---

## 4. Smoke test — curl sequence

Run against the deployed Go backend (dev: `http://localhost:8091`). Get a
Supabase JWT for (a) a member user and (b) a pharmacist with the reviews
permission.

```bash
API=http://localhost:8091            # prod: https://<api-host>
TOK_MEMBER='<supabase-jwt-member>'
TOK_PHARM='<supabase-jwt-pharmacist>'

# 1) T1 term — expect 200, data.tier = "T1", class_groups populated,
#    escalation_card absent, disclaimer text present.
curl -s -X POST "$API/api/finance/health/pharmacy/symptom-search" \
  -H "Authorization: Bearer $TOK_MEMBER" \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: smoke-device-1" \
  -d '{"terms":["body dey pain me"],"refiners":{"who":"ADULT","duration":"TODAY"}}'

# 2) T4 red-flag term — expect 200, data.tier = "T4", NO class_groups,
#    escalation_card with emergency guidance. Commerce must be absent.
curl -s -X POST "$API/api/finance/health/pharmacy/symptom-search" \
  -H "Authorization: Bearer $TOK_MEMBER" \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: smoke-device-1" \
  -d '{"terms":["chest pain"]}'

# 3) Admin queue list — expect 200 and { "data": [ ...review cases... ] }
#    (or empty list on a fresh environment). 403 here = RBAC grant missing (§3).
curl -s "$API/api/health/pharmacy/admin/symptom/reviews" \
  -H "Authorization: Bearer $TOK_PHARM"

# 4) Safety-KPI metrics — feeds the console strip and §5 ritual. Expect 200
#    with by_state / by_tier / open_overdue / median_decision_seconds /
#    searches_24h / gated_share_7d (maps zero-filled on a fresh environment).
#    Ships with the 20260830 hardening build — 404 here means the deployed
#    backend predates it.
curl -s "$API/api/health/pharmacy/admin/symptom/metrics" \
  -H "Authorization: Bearer $TOK_PHARM"
```

Also verify the guardrails while you're here:

- Repeat call (1) >20×/min with the same `X-Device-Id` → expect **429** with
  `X-RateLimit-*` headers (scraping guard).
- A nonsense term (`{"terms":["xyzzy"]}`) → expect **404** ("no symptom term
  matched") — and the miss is logged into `symptom_search_events` for the
  synonym curation loop.
- Server-side quantity cap: submit a pharmacy order whose lines exceed a
  capped SKU's `max_qty_per_window` within its `qty_window_days` rolling
  window → expect **422** with `code: "QTY_CAP_EXCEEDED"` (and remaining
  quantity), enforced fail-closed **before** the escrow hold — the mobile
  stepper cap is cosmetic only (migration `20260830`,
  `backend/internal/health/pharmacy/quantity_gate.go`).
- With the flag **off**, all four calls must return 404 (routes not
  registered).

---

## 5. Safety-KPI weekly review ritual (PRD §9)

Dashboard-pinned safety metrics, **reviewed weekly with the superintendent
pharmacist** — put a recurring 30-min slot in the ops calendar; the
superintendent's attendance is part of the PCN-defensibility posture.

Source: the metrics strip at the top of the console review queue
(`/admin/health/pharmacy-reviews`), backed by
`GET /api/health/pharmacy/admin/symptom/metrics`. If the strip shows em-dashes
("metrics endpoint not deployed") with the flag **on**, the deployed backend
predates the `20260830` hardening build — redeploy; the endpoint ships with it.

| Metric (endpoint field) | Watch for | Threshold |
|---|---|---|
| Open cases by state (`by_state`) | queue building up in PHARMACIST_REVIEW / NEEDS_INFO | trend, not absolute |
| Overdue open cases (`open_overdue`) | SLA breaches | 0 is the target; any sustained >0 = staffing action |
| Median decision time (`median_decision_seconds`) | pharmacist review latency | **< 600 s** (PRD: median <10 min, 08:00–22:00 WAT) |
| Searches, 24 h (`searches_24h`) | volume vs. review capacity | capacity-plan when it grows |
| Gated share, 7 d (`gated_share_7d`) | share of searches landing T2+ | sudden drops = possible mis-tiering — **any T2/T3 gating leak is a Sev-1** |

Standing agenda: (1) the five numbers above vs. last week; (2) any Sev-1 gating
leaks (target: 100% of T2/T3 correctly gated); (3) escalation completion rate
(are T3/T4 users actually reaching a pharmacist?); (4) prescription-verification
rejection reasons; (5) unmatched-term review → AI-suggested synonyms queued for
approval in the mapping workbench.

Minutes go into the same compliance folder as the §0 sign-off artifacts.

---

## 6. Rollback = flag off

```
FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED=false   # + restart the backend
```

Verified: **flag-off restores byte-identical pre-addon behavior.**

- The addon has a single wiring point (`RegisterHealthSymptomSearch` in
  `health_symptom_routes.go`), called only inside
  `if cfg.FeaturePharmacySymptomSearchEnabled { … }` in `finance_routes.go`.
  Flag off ⇒ the block never runs ⇒ no routes registered (all symptom paths
  404) — no existing pharmacy file was modified (brownfield rule).
- The order-flow seam is the optional `ReviewCaseOpener` on the pharmacy
  service; it is only set inside the same flag block, and a **nil opener is a
  no-op** — `CreateOrder` behavior is byte-for-byte unchanged with the flag
  off (documented on `symptomReviewOpener` in the wiring file).
- Migrations stay applied: additive tables/columns are inert while unreferenced.
  Do NOT attempt to unapply them.
- Mobile: the backend flag is the instant kill switch (the compiled-in
  `EXPO_PUBLIC_HEALTH_PHARMACY_SYMPTOM_SEARCH` needs a rebuild to change; with
  the backend off, the symptom screens fail gracefully to their error/empty
  states). Admin: the queue/mappings pages degrade to empty lists (the service
  treats 404 as "not deployed"), and the metrics strip shows em-dashes.

---

## 7. Known limitations (deliberately not faked)

- **Device rate-limit dimension rides the proxy.** The 20 req/min limiter keys
  on `user_id|device_hash`; the device hash comes from `X-Device-Id` (mobile
  sends it; the `/api/v1/health` proxy forwards it). Calls **without** the
  header fall back to hashed client IP — and behind the frontend-web proxy that
  IP can be the proxy's own, so all unheadered traffic may share one bucket.
  The limiter itself is Redis-backed when `REDIS_URL` is configured (fixed
  window holds across all backend instances); it only degrades to in-memory
  per-instance (N replicas ≈ N× the nominal window) when Redis is absent. It
  also fails **open** on Redis errors by design — an infra hiccup never blocks
  members.
- **AI_SUGGESTED language packs are pending approval.** The Hausa / Yoruba /
  Igbo term packs (and the cerumenolytic ear-drops class) from `20260829` are
  seeded `AI_SUGGESTED` — invisible to users until a licensed pharmacist
  approves each row in the mapping workbench. Launch coverage is effectively
  English + Nigerian Pidgin; schedule the approval pass, don't market 5-language
  support until it's done.
- **Review-SLA staffing risk (PRD §10, risk 1).** The <10-min median is a
  staffing commitment, not a software property. The pharmacist rota must cover
  08:00–22:00 WAT before T2 volume ramps; the console's overdue counter is the
  early-warning signal. Mitigate with tiered staffing; expand auto-clear only
  via pharmacist-approved rule changes — never by relaxing gates in code.
- **NDPR retention default is 180 days — confirm it with compliance.**
  Retention **is automated**: `symptomsearch.StartRetentionPurge` invokes
  `pharmacy_symptom_events_purge()` at startup and every 24 h, deleting
  `symptom_search_events` older than `SYMPTOM_EVENTS_RETENTION_DAYS`
  (default 180; linked orders/cases unlink via `ON DELETE SET NULL`, never
  orphan). If compliance prefers the tighter 90-day raw-event window this
  runbook previously recommended, set the env var — no code or migration
  change needed.
