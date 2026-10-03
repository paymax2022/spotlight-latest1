# USER module — production E2E validation results

Date: 2026-10-03. Stack exercised live: Next dev :3000 (Next 16.3.8, turbopack; proxies to `GO_BACKEND_URL=http://localhost:8080`), Go api :8080, GoTrue via Kong :54321, Postgres `supabase_db_spotlight` :54322, Mailpit :54324, fakes :9101.

Specs: `frontend-web/tests/e2e/user/` — 6 specs, all green on `chromium-desktop` (~9.4s total, 4 workers). Every spec runs on its own `provisionVerifiedUser`-created account; shared fixtures only ever read.

Environment facts verified before testing:
- `FEATURE_RESTAURANT_ENABLED=true`, `FEATURE_CROWDFUNDING_ENABLED=true` (frontend-web/.env.local:43-45).
- R2 configured with dev placeholders (`R2_ACCOUNT_ID=local-dev`, no `R2_ENDPOINT`) → `hasR2Config()` is true, so uploads presign against `local-dev.r2.cloudflarestorage.com` and the server-side PUT fails — local-disk fallback never runs (F2).
- `.env.local` still ships `GO_BACKEND_URL=http://localhost:8095` (dead port) — the running dev server and the Playwright webServer stanza override to :8080. Anything spawned without that override will 504 every Go-proxied call (same as noted in auth.md).
- `public.restaurants`, `public.registrations`, `public.cf_*` all start empty; `public.contests` has 4 seeded multi_skill rows; open-mic has **no** contest rows, so `/open-mic/*` user flows have nothing to act on.

## Verdicts

| ID | Journey | Verdict |
|----|---------|---------|
| USER-001 | complete profile | **PASS with gap F3** (web profile editor saves + persists; Go `complete-profile` contract endpoint works but is orphaned — no BFF route, no UI caller) |
| USER-002 | dashboard real data | **PASS** (3 API calls, all 200, counts match payloads; note: no wallet/balance widget exists on this page) |
| USER-003 | primary create flow | **FAIL** — `/apply/[slug]` UI 404s for signed-in users (F1, P1). The create→read→update cycle itself is verified green at the same BFF API the wizard calls, incl. DB row + BOLA. |
| USER-004 | pagination | **PASS** — `/api/v1/restaurant` honours limit/offset, `has_more`/`total` correct, pages disjoint, ordering stable; UI list + empty state sane |
| USER-005 | state persistence | **PASS** — profile field saved → real signOut → real re-login → value intact in UI, API and DB |
| USER-006 | upload | **FAIL** — both user-facing upload surfaces 500 on a real file (F2, P2) |

## Findings

- **F1 — P1: `/apply/[slug]` renders 404 for every signed-in user.**
  `frontend-web/app/apply/[slug]/page.js` reads `params.slug` synchronously
  (`programPageBySlug[params.slug]`); under Next 16 `params` is a Promise, so
  the lookup is `undefined` → `notFound()`. `generateMetadata` has the same
  sync access. Every "Apply Now" link from `/user-dashboard` for
  registration-source programs (`sme-pitch-contest`, `stem-contest`,
  `reality-tv-show`, …) dead-ends. Only the dedicated static children survive:
  `/apply/open-mic-competition` (redirect → `/open-mic/<slug>/apply`) and
  `/apply/film-academy` (redirect → `/film-academy/apply`).
  Evidence: `frontend-web/app/apply/[slug]/page.js` (`params.slug` at ~L14, L26);
  Playwright snapshot `test-results/.../error-context.md` shows the 404 document
  for an authed GET `/apply/sme-pitch-contest`.

- **F2 — P2: user-facing uploads always 500 in this stack.**
  `POST /api/registration/uploads` and `POST /api/crowdfunding/uploads` both
  return `500 {"error":"Upload failed: fetch failed"}` for a valid 1×1 PNG.
  `hasR2Config()` is true (fake `local-dev` creds in .env.local) so the route
  presigns `https://local-dev.r2.cloudflarestorage.com` and the server-side PUT
  fails at fetch. The `saveLocalUpload` dev fallback only runs when R2 is fully
  unconfigured, so it is unreachable here. No object lands anywhere.
  Evidence: `frontend-web/src/lib/storage/r2.ts:15-25,37-38`,
  `frontend-web/app/api/registration/uploads/route.ts` (hasR2Config branch),
  `frontend-web/.env.local:18-21`. Mitigation for the fixture env: either unset
  R2_* to exercise the local fallback, or point `R2_ENDPOINT` at a local S3
  fake.

- **F3 — P3 (gap): `POST /api/auth/complete-profile` is orphaned.**
  Go route live (`backend/internal/app/router.go:159` →
  `handlers/auth_handler.go:536` → writes `public.profiles` via Supabase REST +
  `profile.complete` audit event): 401 unauth, 200 authed — verified. But there
  is no BFF route under `frontend-web/app/api/auth/` and no caller anywhere in
  the web app; the real profile-completion surface is `/profile` →
  `GET/PUT /api/me/profile`. The web dashboard's "Complete Profile (N%)" CTA
  links to `/profile`, so functionally the journey is covered — but the
  contract endpoint is dead code from the web product's perspective.

- **F4 — P4 (contract subtlety): PATCH step-save is a silent no-op on invalid.**
  `PATCH /api/registration/applications/:id` returns **200** with
  `validation.isValid:false` and persists *nothing* when the step's required
  fields are missing (`supabase-store.ts:205-208` returns before the UPDATE).
  Correct wizard behaviour, but API consumers reading only the HTTP status will
  believe the save succeeded.

- **Note (by design):** new restaurants are invisible in discovery —
  `is_open=false` at create, `PATCH /:id/availability` → 403 until
  `kyb_status='approved'` (fail-closed, `restaurant/kyb.go:24`), and discovery
  filters `is_open=TRUE` (+ `listing_review_status='APPROVED'` when moderation
  is on, `discovery_page.go:129-134`). Verified enforced end-to-end.

## Journey details

### USER-001 — complete-profile — PASS (gap F3)
`/profile` → filled First/Last/Display name → **PUT /api/me/profile 200** →
"Profile saved." → GET read-back returns values → `user_profiles.first_name/
last_name` rows match in DB. Unauth GET + PUT → 401. Go probe
`POST :8080/api/auth/complete-profile`: 401 unauth, 200 authed.
Spec: `tests/e2e/user/user-001-complete-profile.spec.ts`.

### USER-002 — dashboard — PASS
`/user-dashboard` issued exactly 3 API calls: `GET /api/me 200`,
`GET /api/me/applications 200`, `GET /api/opportunities 200` — zero 5xx.
"N active contests open" and the `Contests (N)`/`My Applications (N)` tabs
match the payloads; fresh user gets the sane "haven't applied yet" empty state.
No 401s. **Gap note:** the page has no wallet/balance widget — the only
"widgets" are contest/application counts, all real.
Spec: `tests/e2e/user/user-002-dashboard.spec.ts`.

### USER-003 — create flow — FAIL (F1) / API cycle verified
UI: authed `GET /apply/sme-pitch-contest` → 404 document (F1).
API (the calls the wizard makes): **POST /api/registration/applications 200/201**
→ draft id, `registrations` row exists (`contest_slug|status = sme-pitch-contest|draft`)
→ **PATCH :id 200** with full required-field set persists `form_data`
(`contest.entryMode=Individual`, `personal.city=Ikeja`) → **GET :id 200**
read-back matches → foreign user GET/PATCH → **403** (BOLA holds, row
untouched) → unauth POST/GET → **401**.
Spec: `tests/e2e/user/user-003-create-application.spec.ts`.

### USER-004 — pagination — PASS
Provisioned owner created 2 restaurants via **POST /api/v1/restaurant 201**
(real create path), own rows flipped open+approved via psql (fixture setup).
`GET /api/v1/restaurant?q=<tag>&limit=1&offset=0` → 1 record, `total=2`,
`has_more=true`; `offset=1` → the *other* record, `has_more=false`; repeat
page-1 → same id (stable ordering, no dupes). UI `/restaurant` renders both
cards + count; gibberish search → "No restaurants match your search right now."
Unauth GET → 401; foreign PATCH availability → 403 (and `is_open` unchanged).
Spec: `tests/e2e/user/user-004-pagination.spec.ts`.

### USER-005 — persistence — PASS
UI save `city=Persist<ts>` → PUT 200 → signOut (real header control) →
`/user-dashboard` bounces to `/login?next=` → loginViaUi again → `/profile`
input still holds the value; `user_profiles.city` matches.
Spec: `tests/e2e/user/user-005-persistence.spec.ts`.

### USER-006 — upload — FAIL (F2)
Real 1×1 PNG via multipart to both user-facing surfaces:
`POST /api/registration/uploads` → **500** "Upload failed: fetch failed";
`POST /api/crowdfunding/uploads` → **500** same. Auth was accepted (not
401/403), handler reached, structured JSON error — the failure is the R2 PUT
to the unresolvable `local-dev.r2.cloudflarestorage.com` host. No file lands
anywhere (no local fallback while `hasR2Config()` is true). Unauth → 401 both.
Spec: `tests/e2e/user/user-006-upload.spec.ts`.

## Coverage ledger — API paths exercised this run

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` (per-spec provisioning/login)
- `GET|PUT /api/me/profile`, `GET /api/me`, `GET /api/me/applications`
- `GET /api/opportunities`
- `POST /api/registration/applications`, `GET|PATCH /api/registration/applications/:id`
- `POST|GET /api/v1/restaurant`, `PATCH /api/v1/restaurant/:id/availability`
- `POST /api/registration/uploads`, `POST /api/crowdfunding/uploads`
- Go direct: `POST :8080/api/auth/complete-profile`
- Pages rendered: `/login`, `/user-dashboard`, `/profile`, `/apply/[slug]`, `/restaurant`

## Blockers / notes for next run

- Uploads need `R2_ENDPOINT` pointed at a reachable S3 fake (or R2_* unset to
  exercise `saveLocalUpload`) before the happy path can be verified.
- Open-mic user flows are untestable until a `contests` row with
  `contest_type` = open-mic exists — `/open-mic` apply/vote needs a seeded
  contest (admin create path or seed fixture).
- The `/apply/[slug]` 404 (F1) blocks the entire registration wizard UI; once
  `params` is awaited, USER-003's UI step auto-upgrades to asserting the wizard.
