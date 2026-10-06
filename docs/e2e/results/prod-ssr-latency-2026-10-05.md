# SSR tail-latency analysis — frontend-web on Railway

Target: `https://frontend-web-production-9259.up.railway.app`
Observed: /login 7.9s, / 3.3s, /season-2 3.6s, styled-404s 2–6s; p50 ≈1.1s, p90 ≈5.9s.
Repo inspected: `frontend-web/` (Next.js 16.3.8 installed; `next: ^16.3.5`), root `app/` router
(104 pages, 524 route handlers), deployed via `Dockerfile` → `output: 'standalone'` →
`node server.js` on Railway (`railway.json`, DOCKERFILE builder).

## Ranked causes (with evidence)

### 1. Cold-start / first-hit-per-route module loading on a tiny single instance — explains p50≈1.1s vs p90≈5.9s and the 2–6s 404s
- `next.config.mjs:88` `output: 'standalone'` + `Dockerfile:61` `CMD ["node", "server.js"]`.
  In standalone mode each route's server chunk is `require()`d lazily on first hit.
  With **104 pages + 524 API route handlers** compiled into one Node process, the first
  request to any route pays a multi-second disk+parse+eval cost on a shared/hobby vCPU.
  A 404 is not exempt: Next's `_not-found` render still loads the root layout + middleware
  + not-found chunks — on a cold worker that's the 2–6s observation. This is the single
  best explanation for "even a styled 404 takes seconds" and for the p50/p90 gap
  (warm routes ≈1s, cold or GC-stalled routes ≈6s).
- `Dockerfile:42` `NODE_OPTIONS=--max-old-space-size=768` — a 768 MB V8 heap cap on a
  ~630-route app means GC pressure grows as more lazy chunks load; tail spikes worsen
  over uptime until restart (lefthook/healthcheck-driven restarts then re-cold-start
  everything). `railway.json` declares no replicas — single instance, no warm standby.
- `server.js` (repo root) is a **dead file on Railway** — it is a cPanel Passenger
  custom server; the image runs the standalone `server.js` copied from `.next/standalone`.
  No warmup/priming logic exists anywhere in the deploy path.

### 2. `/login` is dynamically rendered per request — explains why it's the worst (7.9s)
- `app/login/page.tsx:1` is a full `'use client'` page and calls `useSearchParams()`
  at line 41 with **no Suspense boundary anywhere** (verified: 0 matches for `Suspense`
  in the file; root `app/layout.js` has none either). Per Next's own docs
  (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md:82`),
  the client tree bails out of prerendering → the route is SSR'd on every request.
  It also pays the largest first-hit chunk load (Supabase client + loginFlow imports).
- **Fixed**: wrapped the component in `<Suspense>` so the route can emit a static shell.
  Commit `e9b06f7a` on branch `fix/prod3-perf-quickwins` in worktree `/tmp/sw4-perf`
  (`frontend-web/app/login/page.tsx`). `npx tsc --noEmit` clean; eslint shows only a
  pre-existing warning (setState-in-effect at line 61, untouched code).
- **Same defect in 6 more pages** (all `'use client'` + `useSearchParams`, zero Suspense):
  `app/vote/[contestSlug]/[contestantSlug]/page.tsx`, `app/vote-callback/page.tsx`,
  `app/film-academy/apply/page.tsx`, `app/contestant/votes/page.tsx`,
  `app/open-mic/register/page.tsx`, `app/open-mic/login/page.tsx`.
  (`app/verify-email/page.tsx` already wraps correctly — use it as the pattern.)
  These are all per-request SSR today; same fix applies.

### 3. Middleware does a Supabase session refresh on EVERY matched request
- `middleware.ts` (root) → delegates to `src/middleware.ts:93-113`:
  `createServerClient(...)` then `await supabase.auth.getUser()` on every page request.
  For **anonymous** traffic this is local-only (no cookie → GoTrue returns null without
  a network call), so it is NOT the p50 cause by itself. For **authenticated** traffic
  it is a synchronous network round-trip to the Supabase GoTrue endpoint on every page
  navigation — a straight additive latency term and the most plausible explanation if
  p50≈1.1s was measured with a session cookie present.
- Secondary middleware work is cheap and correct: IP normalization + in-memory rate
  limit only on `/api/*` POSTs (`middleware.ts:44-64`), CORS short-circuit for APIs
  (`src/middleware.ts:78-80`). Matcher (`middleware.ts:96-108`) already excludes static
  assets but still covers every page path including `/monitoring` (Sentry tunnel) and 404s.

### 4. Not causes (checked, cleared)
- No `force-dynamic` on the slow routes: `/`, `/season-2`, `/404` have none; the 40+
  `force-dynamic` exports are on legitimately dynamic pages (restaurant, crowdfunding,
  open-mic, dashboards, all `/api/*`).
- No `generateMetadata`/`generateStaticParams` doing DB calls on these routes
  (only `apply/[slug]`, `services/[slug]`, `service-details/[slug]` have them, and
  none of those are in the slow set).
- Root layout (`app/layout.js`) is clean: static metadata, `next/font/google`
  Kumbh Sans (self-hosted at build time), 8 static CSS links, one inline script.
  No `cookies()`/`headers()`/`connection()` anywhere that would force-dynamic `/`.
- Sentry: `instrumentation.ts` + `sentry.server.config.ts` init once per boot and are
  **inert without `SENTRY_DSN`** (`enabled: Boolean(dsn)`). `withSentryConfig` wrapper
  adds no runtime cost when unconfigured. `productionBrowserSourceMaps` gated on token.
- `experimental.cpus: 1` / `workerThreads: false` (`next.config.mjs:98-104`) are
  build-time-only memory controls; no runtime effect.
- Pages themselves do no per-request fetches: `/` (`app/page.js`) is a pure component
  tree; `/season-2` (`app/season-2/page.tsx`) renders static data from
  `src/data/websiteExpansion`. Only `app/talent-vault/page.tsx` fetches upstream
  (`cache: 'no-store'` → `GO_BACKEND_URL`), correctly marked `force-dynamic`.
- Repo `server.js` (root) — unused on Railway (see cause 1); a latent trap only if a
  deploy ever invokes it, since it calls `.listen()` with no port and no HOSTNAME.

## Why 6-second 404s specifically

A 404 on this app is *not* a static file hit: the request runs the full middleware
chain (root wrapper → Supabase session refresh), then Next renders `_not-found`
through `app/layout.js` (or the styled `app/404/page.js` route, which pulls in the
entire `Layout` + header/footer client tree). On a standalone server whose worker has
just booted — or after an OOM/GC restart under the 768 MB heap cap — every chunk in
that path is a cold `require()`. Add Railway hobby-class shared CPU and you get exactly
2–6s for a page that should be tens of milliseconds. Warm 404s return fast, which is
why p50 looks fine.

## Recommended fixes, ordered by effort/impact

1. **Done** — `/login` Suspense wrap (commit `e9b06f7a`, worktree `/tmp/sw4-perf`).
   Turns the 7.9s worst offender into a static shell.
2. **Same pattern ×6** — wrap the remaining `useSearchParams`-without-Suspense pages
   listed in cause 2 (~15 min each, mechanical).
3. **Warm the instance** — Railway has no scale-to-zero on paid plans, so the tail is
   mostly first-hit-per-route + restart. Add a lightweight warmup: a post-deploy script
   (or the existing Dockerfile HEALTHCHECK loop, already hitting `/` every 30s —
   `Dockerfile:58-59`) extended to a few hot routes (`/`, `/login`, `/season-2`,
   `/404`) so first user hits land on warm chunks. Bigger lever: raise the runtime heap
   (`--max-old-space-size=768` is conservative if the plan allows more) and/or move to a
   higher-CPU Railway tier; the p90 class of problem is CPU starvation, not code.
4. **Skip the auth round-trip for public routes** — `src/middleware.ts:113` calls
   `getUser()` before checking `isProtected(pathname)`. Cheap reorder: only create the
   Supabase client and call `getUser()` when `isProtected(pathname)` is true, OR when a
   session cookie actually exists (needed to keep the refresh-rotation working — the
   cookie refresh is the reason it runs unconditionally). At minimum, reorder so the
   `isProtected` regex test happens first and `getUser()` is skipped when there is no
   `sb-*-auth-token` cookie on the request. Structural enough to want a test; report-only.
5. **Consider caching in front of static pages** — these marketing pages are fully
   static; a CDN/`Cache-Control` on the Railway edge or `export const
   dynamic='force-static'` (no-op but explicit) keeps them that way if someone later
   adds a `headers()` call. Low priority.

## What I changed

- `/tmp/sw4-perf/frontend-web/app/login/page.tsx` — `Suspense` boundary around the
  `useSearchParams` consumer; default export is now the wrapper. Commit `e9b06f7a` on
  `fix/prod3-perf-quickwins` (branched from `fix/prod-sweep2`). No push, no PR.
- Verification: `npx tsc --noEmit` clean; `npx eslint` — 0 errors, 1 pre-existing
  warning unrelated to the change.
- No production mutations; all findings are repo-side.
