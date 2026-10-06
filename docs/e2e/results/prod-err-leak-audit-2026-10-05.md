# Err-leak audit — frontend-web/app/api (+ src/server surfaces)

Date: 2026-10-05. Base: `prod`. Excluded (already fixed on `origin/fix/prod-sweep2`):
`app/api/auth/{reset-password,otp-verify,verify-otp,resend-otp,forgot-password}/route.ts`.

Note: the PR also edits other files (registration/applications*, crowdfunding/uploads,
admin/contests/banner, v1/contests*, vote-page, telemedicine, plus new catch-alls
`app/api/[...notFound]` and `app/api/auth/[...path]`) — verified: **none of those edits
remove the leak sites below**; the registration/applications changes only add
exact-match domain branches, and the `…: ${detail}` 500 tails remain on the PR branch.

## Safe-path helpers that already exist

- `src/lib/api/responses.ts`
  - `class ApiError extends Error { status }` — message IS the intended client text.
  - `handleApiError(error: unknown, fallbackMessage = 'Internal server error')` —
    ApiError → `error.message` @ `error.status`; `'UNAUTHORIZED'` → 401; `'FORBIDDEN'`
    → 403; anything else → `console.error` + `Sentry.captureException` + fixed
    `fallbackMessage` @ 500.
  - `errorResponse(message, status)` → `{ success: false, error: message }`.
- Auth routes don't import responses.ts; the sibling convention is
  `console.error('[auth/x]', err)` + `NextResponse.json({ error: '<fixed>' }, { status: 500 })`
  (see register:87-88, logout:107-110 — already correct).
- `src/server/registration/supabase-store.ts` wraps PostgREST errors as
  `new Error('Failed to …: ' + error.message)` (lines 93, 427, 534, 636, 648, 668,
  690, 716, 731, 779, 808, 857, 1076) — safe ONLY when the route funnels through
  `handleApiError`; every route below that appends `error.message` to the response
  turns those wrappers into a live PostgREST leak.

## REAL LEAKS — public/auth-facing surface (highest severity)

| file:line | pattern | classification | suggested fix |
|---|---|---|---|
| app/api/auth/login/route.ts:135 | `NextResponse.json({ error: err?.message ?? 'Login failed' }, { status: 500 })` | REAL LEAK — catch-all; `createAnonClient()`/`createServiceClient()` throw env-config internals, `admin.auth.getUser` throws GoTrue/network errors | `console.error('[auth/login]', err)` + fixed `{ error: 'Login failed' }` @ 500 (matches register/logout; named suspect confirmed) |
| app/api/auth/me/route.ts:35 | `{ error: err?.message ?? 'Failed to fetch user' }` @500 | REAL LEAK — same shape; Bearer path, `createServiceClient()`/`getUser` internals | fixed string + `console.error` |
| app/api/registration/uploads/route.ts:132-133 | `errorResponse(`Upload failed: ${detail}`)` where `detail = error.message` | REAL LEAK — `saveLocalUpload` throws fs errors (ENOENT/EACCES + absolute paths), `createR2UploadUrl` throws AWS SDK / R2-config errors | `return handleApiError(error, 'Upload failed')` (keep the console.error) |
| app/api/crowdfunding/uploads/route.ts:80-81 | same `Upload failed: ${detail}` | REAL LEAK — identical throw sites | `handleApiError(error, 'Upload failed')` — sibling `uploads/documents/route.ts:95` already does the fixed-string version |
| app/api/registration/applications/[id]/route.ts:48-49 | `errorResponse(`Failed to load registration application: ${detail}`)` | REAL LEAK — `getRegistrationDraft` → supabase-store wraps PostgREST messages | `handleApiError(error, 'Failed to load registration application')` (UNAUTHORIZED/'not found' branches already handled above it) |
| app/api/registration/applications/[id]/route.ts:107-108 | `…Failed to save registration step: ${detail}` @500 | REAL LEAK — `saveRegistrationStep` wraps PostgREST | `handleApiError(error, 'Failed to save registration step')`; still true on fix/prod-sweep2 (PR adds exact-match 400/422 branches but keeps this tail) |
| app/api/registration/applications/[id]/step/route.ts:92-93 | `…Failed to save registration step: ${detail}` @500 | REAL LEAK — same store | same fix; still present on PR branch |
| app/api/open-mic/uploads/presign/route.ts:73-74 | `message = error.message`; `handleApiError(new Error(message), message)` — wraps into plain Error so the fallback arg (raw message) becomes the 500 body | REAL LEAK — R2/AWS + store internals; defeats handleApiError's redaction | `return handleApiError(error, 'Failed to create upload URL')` |
| app/api/open-mic/submissions/route.ts:84-90 | same `handleApiError(new Error(message), message)` | REAL LEAK — `createSubmission` store/PostgREST | `handleApiError(error, 'Failed to create song submission')` |
| app/api/open-mic/contests/[slug]/apply/route.ts:61-67 | same `handleApiError(new Error(message), message)` | REAL LEAK — `createApplication`/`getContestBySlug` | `handleApiError(error, 'Failed to apply for open mic contest')` |
| app/api/open-mic/contests/[slug]/beat/download/route.ts:55-58 | `message = error.message` echoed at 400/403 on regex match; `handleApiError(new Error(message), message)` at 500 | REAL LEAK — regexes (`/paid entry\|payment/`, `/locked\|not yet approved\|window/`) gate the echo but a PostgREST message containing those words would still echo verbatim; the 500 branch leaks unconditionally | map known domain errors explicitly or drop the verbatim echoes; `handleApiError(error, 'Failed to log beat download')` |

## REAL LEAKS — admin-scoped (PostgREST `error.message` → admin console)

All behind `assertAdminPermission`/`assertOpenMicAdmin`, so the audience is
authenticated admins only — still hands Postgres schema/constraint/SQLSTATE text
("duplicate key value violates unique constraint …", "invalid input syntax for
type timestamp", "column … does not exist") to a browser client.

| file:line | pattern | classification | suggested fix |
|---|---|---|---|
| app/api/admin/payments-finance/route.ts:50,109 (surfaced at :141-143,:154) | `error?.message` embedded in `ledgerEntries.error`, `kycProfiles.error`, `virtualAccounts.error`, `stats.error` payload fields | REAL LEAK (admin) — PostgREST messages in the 200 body | return a boolean/`'unavailable'` flag or fixed label per section; log the message server-side |
| app/api/admin/voting/package-templates/route.ts:56,97,154,183 | `errorResponse(error.message, 500)` | REAL LEAK (admin) — PostgREST | `errorResponse('Failed to …', 500)` + `console.error` |
| app/api/admin/voting/settings/route.ts:68→201, :197 | `return error.message` from `syncContestVotingState` embedded in 500 body; direct `errorResponse(error.message, 500)` | REAL LEAK (admin) | fixed suffix at :201; fixed string at :197 |
| app/api/admin/voting/contest-templates/[templateId]/route.ts:21 | `errorResponse(`Failed to load template: ${error.message}`)` | REAL LEAK (admin) | fixed string |
| app/api/admin/voting/contest-templates/route.ts:44 | `…Failed to load templates: ${error.message}` | REAL LEAK (admin) | fixed string |
| app/api/admin/voting/contest-prizes/route.ts:24,88 | `…${error.message}` @500 | REAL LEAK (admin) | fixed string |
| app/api/admin/voting/[contestId]/transactions/route.ts:31 | `Response.json({ success:false, error: error.message })` @500 | REAL LEAK (admin) | fixed string |
| app/api/admin/voting/packages/route.ts:83,130 | `errorResponse(error.message, 500)` | REAL LEAK (admin) | fixed string |
| app/api/admin/voting/rounds/[roundId]/results/route.ts:25 | `…Failed to load results: ${error.message}` | REAL LEAK (admin) | fixed string |
| app/api/admin/voting/rounds/route.ts:49,78 | `errorResponse(error.message, 500)` | REAL LEAK (admin) | fixed string |
| app/api/admin/voting/phases/route.ts:59,92 | `errorResponse(error.message, 500)` | REAL LEAK (admin) | fixed string |
| app/api/admin/academy/progress/route.ts:85,89,105 | `errorResponse(partsRes.error.message / subsRes… / partSubsRes…, 500)` | REAL LEAK (admin) | fixed string per query |
| app/api/admin/academy/curriculum/route.ts:119 | `errorResponse(error.message, 500)` | REAL LEAK (admin) | fixed string |
| app/api/admin/academy/submissions/route.ts:24,84 | `errorResponse(error.message, 500)` | REAL LEAK (admin) | fixed string |
| app/api/admin/academy/assignment-parts/route.ts:27,105,155,193,220 | `errorResponse(error.message, 500)` | REAL LEAK (admin) | fixed string |
| app/api/admin/applications/bulk-action/route.ts:101 | per-item `error: error.message` inside `results[]` returned at 200 | REAL LEAK (admin) — per-application Supabase/service errors | fixed `'Failed'` per item + console.error |
| app/api/admin/contests/route.ts:147 | `detail: String(err)` inside `publish` field of 201 response | REAL LEAK (admin) — fetch/Error internals from `publishContestToVotingPlane` | drop `detail` or return `reason` only |
| app/api/admin/contests/[slug]/status/route.ts:47 | `errorResponse(`Failed to update contest status: ${error.message}`)` | REAL LEAK (admin) — PostgREST | fixed string |
| app/api/admin/contests/[slug]/route.ts:168,170 | `errorResponse(message, 400/409)` when message contains 'required'/'Invalid'/'valid'/'already exists' | REAL LEAK (admin) — substring trap: `includes('valid')` matches PostgREST "in**valid** input syntax for type uuid", echoing the raw pg message at 400 | switch on exact domain strings (as the PR does in registration routes) or map to fixed messages |

## AMBIGUOUS

| file:line | pattern | classification | suggested fix |
|---|---|---|---|
| app/api/auth/recovery-session/route.ts:13 | `{ error: error.message }` @401 from `supabase.auth.setSession` AuthError | AMBIGUOUS — GoTrue auth messages are nominally client-facing ("Invalid Refresh Token…") but it's a verbatim upstream pass-through, inconsistent with login's deliberately-generic policy. Judgment: minor — no DB internals possible; fix if the generic-message policy is meant to cover auth endpoints | fixed `{ error: 'Invalid recovery session' }` @401 |
| app/api/admin/contests/[slug]/stages/[stageId]/route.ts:35,51 | `errorResponse(message, 404)` when message contains 'not found' | AMBIGUOUS — throw sites are store/domain errors where 'not found' text is intended; a PostgREST error containing that substring would echo raw. Low risk, admin audience | fixed 'Stage not found' @404 |
| src/server/registration/error-handler.ts:19,51,55 | `handleRegistrationError` returns `errorMessage` verbatim @400 and `…: ${errorMessage}` @500 | AMBIGUOUS/latent — currently unused (no imports under app/), but if wired it is a leak by design | delete or align with handleApiError; safe to leave if dead code |
| app/api/admin/open-mic/contests/[id]/route.ts:43 | `errorResponse(`${fallback}: ${error.message}`)` — behind `NODE_ENV !== 'production'` | SAFE in prod / dev-only detail | optional: drop the env branch |
| app/api/admin/open-mic/contests/[id]/beats/route.ts:14 | `handleApiError(error, `…: ${error.message}`)` — same NODE_ENV gate | SAFE in prod / dev-only | optional |

## SAFE (verified — no client exposure)

- All `error.message === 'UNAUTHORIZED'` / `'FORBIDDEN'` / `'Application not found'` / `'contest not found'` comparisons (~30 sites: kyc/*, realtor/ai/*, me/*, academy/*, open-mic/*, registration/*, admin/contests/[slug]:139,153,184,192, contest-categories:56-59, admin/open-mic/contests/[id]:39) — message used for matching, fixed text returned.
- `console.error`/`console.warn`-only sites: auth/login:57,124; auth/register:60,87; auth/logout:75,109; auth/otp-verify:72; academy/apply:147; admin/contests:145; admin/academy/interest-areas:63-66 (logs code/message/details/hint server-side only — the comment there already states the correct policy).
- `academy/apply/route.ts:72,84,407-416` — PostgREST/paystack messages used for keyword matching only; fixed strings returned; final catch → `handleApiError` with fixed fallback.
- `registration/applications/route.ts:80` — `RegistrationExistsError` is a domain error whose `message`/`code`/`registration` ARE the intended 409 client payload.
- `crowdfunding/uploads/documents/route.ts:94-95` — console.error + fixed 'Upload failed'.
- `votes/paid/wallet/route.ts:242` — `healErr.code !== '23505'` internal check.
- Everything else (≈590 catch-block returns audited across 516 files) already routes through `handleApiError(error, '<fixed>')` or returns fixed strings (e.g. `{ error: 'Internal server error' }` in v1/doctor, v1/restaurant, v2/votes routes).

## Count summary

- REAL LEAK: **12 sites in 9 files** user-facing + **~30 sites in 21 files** admin-scoped = **~42 sites / 30 files**
- AMBIGUOUS: **4 sites / 4 files** (recovery-session, stages×2 lines one file, dead src/server helper, 2 dev-only env-gated admin sites counted separately)
- SAFE: remainder — the dominant pattern repo-wide is already correct `handleApiError`.

Excluded per instructions: `auth/reset-password`, `auth/otp-verify`, `auth/verify-otp`,
`auth/resend-otp`, `auth/forgot-password` (fixed on fix/prod-sweep2; on prod their
`err?.message`/`error.message` returns remain until that PR merges).
