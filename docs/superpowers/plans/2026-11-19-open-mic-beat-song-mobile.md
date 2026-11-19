# Open Mic: beat download → song upload → voter playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans (or subagent-driven-development) to work this list task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the Open Mic loop on localhost and in production code paths — the applicant plays and downloads the admin's beat, and after approval uploads the song they made on it, which is then playable by every voter on mobile, on the contestant profile, and on the web vote page.

**Architecture:** One `contests` row per Open Mic edition (the registration catalog adopts the `one_beat_one_verse` type the Open Mic plane already speaks), one song object key vocabulary in `src/features/openmic/song-storage.ts`, one eligibility decision in `src/server/openmic/submission-eligibility.ts`, and one storage branch (`hasR2Config()`) replicated faithfully into the song path so R2-less dev behaves like R2-having prod. Songs are surfaced to voters as a **new** `song_url` on the connect roster — joined from `competition_entries` through the promoted `contestants` row — never by overloading `contestants.media_url`.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript, Supabase JS (`createAdminClient`), Cloudflare R2 SDK + local-disk fallback, vitest (node env), Go 1.x + `pgx` for the connect plane, Expo SDK 54 (`expo-audio`, `expo-file-system` 19, `expo-sharing` 14, `expo-document-picker`), React Query.

**Spec:** [docs/superpowers/specs/2026-11-19-open-mic-beat-song-mobile-design.md](../specs/2026-11-19-open-mic-beat-song-mobile-design.md) — it argues the decisions; this plan executes them.

## Global Constraints

- Work happens in the git worktree `/Users/paymax/Documents/spotlight/main/.worktrees/openmic-beat-song` on branch `feat/openmic-beat-song-mobile` (base `origin/main` `5e175656d`). The main checkout carries ~194 unrelated dirty files, including `frontend-web/app/vote/[contestSlug]/[contestantSlug]/page.tsx`, which this plan edits — do not work there.
- **No migration, no DDL, no production write.** The whole design lands on columns that already exist.
- The shell PATH on this machine is unreliable (`curl`, `head`, `sort`, `lsof` go missing). Prefix every Bash call with `export PATH=/usr/bin:/bin:/usr/sbin:/usr/local/bin:/opt/homebrew/bin:$PATH`. The tool's cwd resets between calls — use absolute paths.
- Stage by explicit path, one commit per logical change, and commit with an explicit pathspec (`git commit -m "…" -- <paths>`) because this is a shared repo where other sessions touch the index. Never `git add -A`. Never stage `next-env.d.ts`, `.env*`, `node_modules`, or `mobile-app/reactnative/outputs/`.
- `.claude/hooks/protect-legacy.sh` blocks edits to 41 brownfield paths — `frontend-web/src/server/registration/store.ts`, `src/features/registration/config.ts`, and `app/api/registration/applications/{route,[id]/route,[id]/submit,[id]/withdraw,[id]/status}` among them. The house answer is **additive**: new routes/modules beside the protected ones (`app/api/open-mic/*` is that precedent). Do not edit the protected list away.
- vitest runs `environment: 'node'` — no jsdom. Component *rendering* is proven in a browser; component *logic* lives in plain testable modules. Playwright for this app needs `--workers=1`.
- `frontend-web/tests/unit/openmic/**` is not in any CI lane's include list (`test:regression` = golden-path, `test:money` = estate/wallet/tiers). Run new tests explicitly; CI still proves them through `tsc` + lint + build. Widening a lane is out of scope.
- Content types are decided **server-side from the extension**, never from a client-supplied `file.type` (SEC-007, `app/api/registration/uploads/route.ts:10-38`). An mp3 is served `audio/mpeg`.
- Registration endpoints live on the Next.js server, **not** Go `/api/v1`. Mobile reaches them through `resolveApiBaseUrl()` + `getDevUrl()` (which rewrites `localhost` to the Metro LAN IP, or `10.0.2.2` on the Android emulator) — so any relative API path a server hands back must be resolved on the client before it reaches a device.
- **Never print `.env.local` or any credential** — presence/length only. `mobile-app/reactnative/src/config/env.ts` throws in `NODE_ENV=production` if `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY` are missing, so mobile test runners set `NODE_ENV=test` (see `tests/unit/register-ts-paths.mjs`).
- Merging this branch publishes `frontend-web` to `www.spotlightng.com` in ~7 minutes (`sync-frontend-web.yml` → cPanel). Pushing and opening the PR are authorised; **merging is the owner's call**.

## File structure

| Path | Role | Task |
|---|---|---|
| `frontend-web/src/features/openmic/song-storage.ts` | **New.** The song object-key vocabulary: `buildSongObjectKey`, `isSongObjectKeyFor`, `songReaderUrl`, `DIRECT_SONG_UPLOAD_PATH`, `MAX_SONG_BYTES`, `SONG_EXTENSION`. | 1 |
| `frontend-web/src/lib/storage/local-uploads.ts` | **Extended.** `statLocalUpload`, `readLocalUploadRange` for ranged playback off disk. | 1 |
| `frontend-web/src/server/openmic/submission-window.ts` | **New.** The one strict submission-window rule + a reason code. | 1 |
| `frontend-web/src/server/openmic/submission-eligibility.ts` | **New.** `getSongSubmissionEligibility({contest, userId})` → `{eligible, source, reason}`; the approval gate, and the reason `createSubmission` can also use. | 2 |
| `frontend-web/app/api/open-mic/uploads/presign/route.ts` | Mode-aware: presigned PUT with R2, direct multipart descriptor without. | 3 |
| `frontend-web/app/api/open-mic/uploads/route.ts` | `410` with R2, multipart→`saveLocalUpload` sink without. | 3 |
| `frontend-web/app/api/open-mic/uploads/complete/route.ts` | Storage-agnostic existence assert; keys through the shared builder. | 3 |
| `frontend-web/app/api/open-mic/songs/[id]/route.ts` | Public reader: R2 proxy **or** local ranged stream, same `206`/CORS contract. | 4 |
| `frontend-web/app/api/admin/open-mic/submissions/[id]/song/route.ts` | Admin preview reader: same branch. | 4 |
| `frontend-web/app/api/open-mic/me/eligibility/route.ts` | **New.** `?contestSlug=` → `{eligible, source, reason, beatDownloadUrl, submissionStartAt, submissionEndAt}`. | 5 |
| `frontend-web/src/features/openmic/beat-public-url.ts` | **New.** Absolute-ise a beat reader path from the server (`SITE_URL_BASE`), shared by the eligibility route and the vote page. | 5 |
| `frontend-web/app/api/open-mic/contests/[slug]/beat/download/route.ts` | `logBeatDownload` on the GET that serves the bytes. | 5 |
| `frontend-web/src/features/registration/reference-data.ts` | Open Mic `contestType: 'public_voting_contest'` → `'one_beat_one_verse'`. | 6 |
| `frontend-web/src/server/registration-v2/publish-to-voting.ts` | Stop rewriting `contest_type` when the row is already the Open Mic type. | 6 |
| `frontend-web/src/server/registration/supabase-store.ts` | Slug-tolerant Open Mic resolution in `resolveAnyContest`. | 6 |
| `frontend-web/src/server/openmic/persistence.ts` | Newest-active beat in `mapContestRow`; retire prior beats in `upsertBeat`; eligibility gate + shared window rule in `createSubmission`; key builder in `recordSubmissionUploadComplete`. | 6, 7 |
| `frontend-web/app/api/vote-page/route.ts` | Resolve the contestant's `song_url`; stop hardcoding `audioUrl: null`. | 8 |
| `frontend-web/app/vote/[contestSlug]/[contestantSlug]/page.tsx` | Render an `<audio controls>` player for the song. | 8 |
| `backend/internal/connect/voting/repo.go` | `RosterEntry.SongURL`/`SongStatus` + `LEFT JOIN LATERAL` onto `competition_entries`. | 9 |
| `backend/internal/connect/voting/repo_test.go` (or the file's existing suite) | Roster test: song present for an approved entry, null otherwise. | 9 |
| `contracts/voting.openapi.yaml` | Document `song_url`, `song_status`. | 9 |
| `mobile-app/reactnative/src/features/openmic/` | **New module.** `api.ts`, `types.ts`, `state.ts` (eligibility → UI state), `useBeat.ts`, `useSongUpload.ts`, `components/{BeatCard,SongUploadCard,SongPlayer}.tsx`. | 10–12 |
| `mobile-app/reactnative/app/openmic/beat.tsx`, `song.tsx` | **New screens.** | 11, 12 |
| `mobile-app/reactnative/app/voting/contestant-profile.tsx` | `SongPlayer` when `song_url`, `Linking` sample retained otherwise. | 13 |
| `mobile-app/reactnative/app/registration/[id]/status.tsx` | Route the existing `ContestVotingCard` CTA into the Open Mic flow for Open Mic contests. | 12 |
| `mobile-app/reactnative/src/lib/api-base-url.ts` | Export a helper that resolves a server-relative path to an absolute device URL. | 10 |
| `frontend-admin/src/services/openMicAdminService.ts` + `app/admin/open-mic/[id]/page.tsx` | Song review (approve/reject + feedback) and the submission window hint. | 7 |
| `frontend-web/tests/unit/openmic/*.test.ts` | Window, key, eligibility, presign modes, reader ranges. | 1–5 |

## Sequencing

Tasks 1 → 2 → 3 → 4 are one vertical slice (a song can be uploaded and played back on localhost with R2 unset). Task 5 makes that reachable from an authenticated client. Task 6 is the identity unification the beat upload depends on. 7 is admin, 8 is web voters, 9–13 mobile + Go + verification. **Do not start task 10 until 5 and 6 are green** — mobile would be built against an unreachable API.

---

### Task 1 — Song-key vocabulary, disk primitives, the one window rule

**Files:** `frontend-web/src/features/openmic/song-storage.ts`, `frontend-web/src/lib/storage/local-uploads.ts`, `frontend-web/src/server/openmic/submission-window.ts`, `frontend-web/tests/unit/openmic/song-storage.test.ts`, `frontend-web/tests/unit/openmic/submission-window.test.ts`

- [ ] Write `song-storage.test.ts` first: the builder yields `openmic/<slug>/<userId>/<submissionId>.mp3` and falls back to the id when the slug is empty; `isSongObjectKeyFor` rejects `openmic/other/…`, a foreign `artistUserId`, `..` traversal, a 4th path segment, a `.svg` stem, and a non-UUID submission stem; `songReaderUrl(id)` is `/api/open-mic/songs/<id>`.
- [ ] Write `submission-window.test.ts`: `status:'submission_open'` → open with no dates; only-start before/past; only-end before/past; **no dates and any other status → closed**; unparseable date → treated as absent; reason codes `before_start`/`after_end`/`no_window_configured` and the `startsAt`/`endsAt` echo.
- [ ] Run both; they must fail red for the missing modules.
- [ ] `local-uploads.ts` gains `statLocalUpload(key): {sizeBytes}|null` and `readLocalUploadRange(key,{start,end?}): {buffer,start,end,totalBytes}|null`, both going through the existing private `resolveLocalPath` so nothing escapes the root, and both returning `null` rather than throwing on a missing file.
- [ ] Implement `song-storage.ts` and `submission-window.ts` (as drafted); export `SONG_EXTENSION`, `MAX_SONG_BYTES = 50 MiB`, `SONG_CONTENT_TYPE = 'audio/mp3'`, `DIRECT_SONG_UPLOAD_PATH`, `isSongObjectPrefix`, `contestSongRef`, `songContestRef`, `buildSongObjectKey`, `isSongObjectKeyFor`, `songReaderUrl`, `isUUID`.
- [ ] Re-run green. `npx tsc --noEmit` in `frontend-web`.

Run: `cd frontend-web && npx vitest run tests/unit/openmic/song-storage.test.ts tests/unit/openmic/submission-window.test.ts`

### Task 2 — The eligibility gate

**Files:** `frontend-web/src/server/openmic/submission-eligibility.ts`, `.../submission-eligibility.test.ts`

- [ ] Test the pure classifier `classifyEligibility({hasContestant, enrollmentStatus, registrationStatus, window})` first: `ok` for each of the three sources in priority order; `not_approved` for pending/rejected/not-found; `draft` beats nothing — a `rejected` enrollment must not be rescued by a missing registration; `window_closed` only when the source is `ok`.
- [ ] Implement the classifier plus the I/O wrapper `getSongSubmissionEligibility({contest, userId})`: `contestants` row matching `(contest_id = contest.id OR connect_contest_id = contest.id OR contest_id = contest.slug OR connect_contest_id = contest.slug) AND user_id = userId` → `source:'promoted'`; else `competition_enrollments` (`competition_id`,`user_id`) status in the approved set → `'enrollment'`; else `registration_applications` (`user_id`, contest) with status in `PROMOTING_STATUSES` → `'registration'`; else `'none'`. Guard: an unregistered app also carries `contestants`, so `source:'promoted'` additionally requires `beat`-bearing contest — the caller passes `contest`, and a missing `contest.beat` is its own reason (`beat_missing`) so the UI can blame the right thing.
- [ ] Add `reason` strings the clients will switch on: `ok`, `not_approved`, `window_closed`, `beat_missing`, `no_contest`.
- [ ] `npx tsc --noEmit` + tests green.

### Task 3 — Upload: presign modes, direct sink, complete

**Files:** `app/api/open-mic/uploads/presign/route.ts`, `uploads/route.ts`, `uploads/complete/route.ts`, `tests/unit/openmic/song-upload.test.ts`

- [ ] Test the shared request validator (extract it to `src/server/openmic/song-upload-request.ts` so a node-env test can call it without a running server): mp3 extension, `audio/mp3` contentType, positive `fileSize`, ≤ 50 MiB → `{ok}` or `{error, status}`.
- [ ] presign: after validation, load the contest, call `getSongSubmissionEligibility`, `403` with `{reason}` when not eligible. Then branch on `hasR2Config()` — signed PUT when configured, `{mode:'direct', uploadUrl: DIRECT_SONG_UPLOAD_PATH, method:'POST', fieldName:'file'}` when not. Both branches return `submissionId`, `objectKey`, `readerUrl`, `maxBytes`.
- [ ] `uploads/route.ts`: `hasR2Config()` → keep the `410` with the existing message (prod must not become a file server). Otherwise parse `formData`, take `file`/`contestSlug`/`submissionId`, re-derive the expected key with `buildSongObjectKey`, `requireRequestUser`, re-check eligibility, enforce the mp3 extension + size cap from the **server's** view of the bytes, `saveLocalUpload(objectKey, buffer)`, and answer `{stored:true, objectKey, readerUrl}`.
- [ ] `complete`: keys through the builder, existence via `assertR2ObjectExists` **or** `statLocalUpload`, then `recordSubmissionUploadComplete`, then `signedUrl` = the R2 signed GET or `songReaderUrl(submissionId)` locally.
- [ ] Tests green; `tsc` green.

### Task 4 — Playback: the public and admin readers, both storages

**Files:** `app/api/open-mic/songs/[id]/route.ts`, `app/api/admin/open-mic/submissions/[id]/song/route.ts`, `tests/unit/openmic/song-reader.test.ts`

- [ ] Test the pure range parser first: `bytes=0-1023`, `bytes=2048-`, `bytes=-500` (suffix), absent header, garbage header, `start > end`, `start >= total` → `416`.
- [ ] `songs/[id]`: look up the row, allowlist `['submitted','published_for_voting','finalist','winner','live_for_voting']` (a rejected/draft entry must 404), read `songObjectKey || r2ObjectKey` from `lyrical_concept_summary`, then proxy R2 as today **or** serve from `readLocalUploadRange`. Identical response contract either way: `Accept-Ranges: bytes`, `Cache-Control: public, max-age=300`, the CORS pair, `Content-Range` and `206` on a range, `Content-Type` from `contentTypeForKey`.
- [ ] Admin song route: same branch, admin-authenticated as it already is.
- [ ] Tests + `tsc` green.

### Task 5 — Applicant-facing API: eligibility and the beat log

**Files:** `app/api/open-mic/me/eligibility/route.ts`, `src/features/openmic/beat-public-url.ts`, `app/api/open-mic/contests/[slug]/beat/download/route.ts`, tests

- [ ] `beat-public-url.ts`: `absoluteBeatUrl(readerPath, origin)` — passes an already-absolute URL through, prefixes a `/api/open-mic/beats/…` path with the site origin, returns `null` for a legacy `/api/registration/uploads/…` path (that route is owner-only).
- [ ] `GET /api/open-mic/me/eligibility?contestSlug=`: `requireRequestUser` → 401 body when signed out; otherwise `{eligible, source, reason, beatPreviewUrl, beatDownloadUrl, beatTitle, usageRules, submissionStartAt, submissionEndAt, contestId, contestSlug, status}` with the beat URLs absolutised.
- [ ] The beat download GET: call `logBeatDownload({contestId, beatId, userId, ipAddress, userAgent})` before the redirect so the admin's download list is real. Never log a token or query string.
- [ ] Tests: the eligibility route maps a signed-out request to 401 and a non-eligible user to `{eligible:false, reason}`; `absoluteBeatUrl` cases.

### Task 6 — One Open Mic contest

**Files:** `src/features/registration/reference-data.ts`, `src/server/registration-v2/publish-to-voting.ts`, `src/server/registration/supabase-store.ts`, `src/server/openmic/persistence.ts`, tests

- [ ] Catalog: Open Mic `contestType` → `'one_beat_one_verse'`; keep `slug:'open-mic-competition'`, `contestCategory:'open_mic'`, `supportsVoting`, the ₦2,000 fee and `categoryQuestionSet:'open_mic'` untouched.
- [ ] Test `publish-to-voting`'s new rule: `contest_type` is written on insert, and on update is **never** overwritten when the existing row is `one_beat_one_verse`.
- [ ] `supabase-store.resolveAnyContest`: when the catalog entry is Open Mic, tolerate the other plane's slug so a reader finds the unified row whichever slug the client was given.
- [ ] `mapContestRow`: pick the newest **active** beat (`is_active === true`, then `created_at` desc, then fall back to the newest row) instead of `competition_beats[0]`, so a second upload actually takes effect.
- [ ] `upsertBeat`: when activating a beat, set `is_active = false` on the contest's other beats, so exactly one beat is playable.
- [ ] `createSubmission`: replace the local window check with `isSubmissionWindowOpen`, and the enrollment-only approval check with `getSongSubmissionEligibility` (keeping the enrollment lookup for the fee/payment check it already does).
- [ ] `recordSubmissionUploadComplete`: use `buildSongObjectKey`.
- [ ] Grep for other `openmic/` key builders and route them through the shared one.
- [ ] Existing suite still green: `npx vitest run tests/unit/openmic tests/unit/registration tests/unit/config`.

### Task 7 — Admin: review the song, and see why uploads are closed

**Files:** `frontend-admin/src/services/openMicAdminService.ts`, `frontend-admin/app/admin/open-mic/[id]/page.tsx`, `frontend-admin/tests/admin/openmic/*`

- [ ] Service: `reviewOpenMicSubmission(id, {decision, feedback})` → `POST ${webBase()}/api/admin/open-mic/submissions/<id>/review`, and `previewOpenMicSubmissionSong(id)`.
- [ ] Console: a per-submission row action to play the song and to approve/reject with a feedback note; a visible hint on the edition editor when the submission window is unset, because task 1 makes that mean closed.
- [ ] Behavioural test in `frontend-admin`'s jsdom setup: clicking review posts the decision through the proxy.

### Task 8 — Web voters can play the song

**Files:** `app/api/vote-page/route.ts`, `app/vote/[contestSlug]/[contestantSlug]/page.tsx`

- [ ] Replace the hardcoded `audioUrl: null` with the contestant's song reader URL (absolute, via `beat-public-url`'s sibling logic).
- [ ] Vote page: render `<audio controls preload="none" src={audioUrl}>` beside the existing `<video>` when `audioUrl` is set, with a caption naming it the contestant's Open Mic entry.
- [ ] Unit test the API mapping: entry present → `audioUrl`; no entry → `null`, and `media_url` untouched.

### Task 9 — Go: the connect roster carries the song

**Files:** `backend/internal/connect/voting/repo.go`, its test file, `contracts/voting.openapi.yaml`

- [ ] `RosterEntry` gains `SongURL string \`json:"song_url"\`` and `SongStatus string \`json:"song_status"\``.
- [ ] `ListRoster`/`GetRosterEntry`: `LEFT JOIN LATERAL` onto `competition_entries` on `(competition_id, user_id)` restricted to the same status allowlist, newest first, projecting the reader path `/api/open-mic/songs/<entry id>` — computed in SQL from the entry id so the BFF does not parse JSON.
- [ ] Extend the scans; every other roster consumer keeps compiling because these are additive fields.
- [ ] Test against the live-DB suite: an approved entry yields a `song_url`; a `rejected` one does not.
- [ ] `contracts/voting.openapi.yaml`: document both fields on the roster schema.
- [ ] `go build ./... && go vet ./... && go test ./internal/connect/...`.

### Task 10 — Mobile plumbing

**Files:** `mobile-app/reactnative/package.json`, `src/lib/api-base-url.ts`, `src/features/openmic/{types,state}.ts`, `api.ts`, tests

- [ ] `npx expo install expo-audio expo-document-picker` (the dev client rebuilds; record that a rebuild is needed).
- [ ] `resolveApiBaseUrl()`: also export `resolveAppUrl(pathOrUrl)` — absolute in, absolute out; `/api/...` prefixed with the backend origin **after** `getDevUrl()`'s localhost rewrite, because a phone cannot resolve `localhost`.
- [ ] `types.ts` + `state.ts`: the eligibility payload → a UI state union (`sign_in`, `no_contest`, `beat_missing`, `awaiting_approval`, `submissions_closed`, `ready_to_download`, `ready_to_upload`, `uploaded`, `published`), one pure function, unit-tested for every variant.
- [ ] `api.ts`: `fetchEligibility`, `logBeatDownload`, `presignSongUpload`, `uploadSongDirect`, `completeSongUpload`, `submitSong` — POST-only through `getAuthenticatedJson`/`requestJsonWithRetry`, each with an explicit method so the default-GET trap can't recur.

### Task 11 — Mobile: beat screen

**Files:** `app/openmic/beat.tsx`, `src/features/openmic/components/BeatCard.tsx`, `useBeat.ts`, tests

- [ ] `useBeat`: `expo-audio`'s `useAudioPlayer(resolveAppUrl(beatPreviewUrl))` with play/pause + seek; state machine `loading/ready/error`.
- [ ] Download: `Directories.createFileUriAsync` (v19 API) → `downloadAsync` → `Sharing.shareAsync(uri, {mimeType:'audio/mpeg'})`, plus a "Saved to Files" note when sharing is unavailable. Progress percentage in state, asserted by the test.
- [ ] Screen: beat title/producer, the usage rules, play/pause, download, and the "I accept the beat usage terms" checkbox that gates the download button. No dead affordance when `allowDownload === false` or the beat is preview-only — say so in words.

### Task 12 — Mobile: song upload + entry into the flow

**Files:** `app/openmic/song.tsx`, `src/features/openmic/components/SongUploadCard.tsx`, `useSongUpload.ts`, `app/registration/[id]/status.tsx`, `src/features/registration/components/ContestVotingCard.tsx`, tests

- [ ] `useSongUpload`: pick `.mp3` via `expo-document-picker` → size/type guard client-side **and** server-side → presign → (direct POST or PUT to the signed URL) → `complete` → `submitSong` with the three declarations. Expose `{progress, status, error}`, retryable per step.
- [ ] Screen: shows eligibility state first; only offers upload when `eligible`; lists the three declarations as explicit checkboxes (`officialBeatConfirmed`, `ownershipConfirmed`, `noUnauthorizedSamplesConfirmed`) and refuses to upload without them.
- [ ] `ContestVotingCard`: for an Open Mic contest, the existing CTA routes to `/openmic/beat` or `/openmic/song` based on eligibility, keeping the current copy for non-Open-Mic contests.
- [ ] Tests: the upload state machine's transitions (including a mid-flight failure staying retryable) and the card's routing decision.

### Task 13 — Mobile: voters play the song

**Files:** `app/voting/contestant-profile.tsx`, `src/features/openmic/components/SongPlayer.tsx`, `src/lib/connect/voting.types.ts`, `connectVoting.mapper.ts`, tests

- [ ] Types + mapper: `songUrl`/`songStatus` from the new roster fields.
- [ ] `SongPlayer`: `useAudioPlayer(resolveAppUrl(songUrl))`, play/pause, elapsed/duration, a mute toggle; a clear "Song unavailable" state when the URL fails.
- [ ] Profile: render `SongPlayer` when `songUrl`, keep the `Linking.openURL` sample row only when `mediaUrl` is separately present, and mark which is the contest entry.
- [ ] Tests: mapper defaults, and the profile's choice between song/sample/none.

### Task 14 — Verification

- [ ] `cd frontend-web && npx tsc --noEmit && npx eslint app components lib src && npx vitest run tests/unit/openmic tests/unit/media tests/unit/registration tests/unit/config`.
- [ ] `cd backend && go build ./... && go vet ./... && go test ./internal/connect/...`.
- [ ] `cd frontend-admin && npx tsc --noEmit && npm test` (its own runner).
- [ ] `cd mobile-app/reactnative && npm run typecheck && node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/openmic/*.spec.ts"` and the existing `tests/unit/registration`, `tests/unit/voting`, `tests/unit/api` suites.
- [ ] Live localhost run, R2 **unset**, from a tree with no peer Metro: register → pay → play beat → download beat (confirm the `beat_download_logs` row) → presign before approval → expect `403 not_approved` → admin approves → presign → upload → complete → `createSubmission` → `/api/open-mic/songs/<id>` returns `200` and a `Range` request returns `206` → web vote page plays → mobile profile plays → admin rejects → the reader returns `404`.
- [ ] Record in the PR which legs were actually exercised versus only type/lint checked.

## Self-review notes

- Spec §D1 ↔ task 6, §D2 ↔ tasks 8–9, §D3 ↔ tasks 10–13, §D4 ↔ task 2 (+3), §D5 ↔ task 1 (+6), §D6 ↔ tasks 1, 3, 4. Every spec section has an owning task; every task names its files.
- No placeholder language: each step states the check that proves it.
- One deliberate ambiguity resolved in code rather than prose: `getSongSubmissionEligibility` matches `contestants` on both `contest_id` and `connect_contest_id` and accepts either the id or the slug, because the pre-merge data may hold either key. The Go roster join deliberately matches the narrower `(competition_id, user_id)` pair, because that is the table the song lives in.
