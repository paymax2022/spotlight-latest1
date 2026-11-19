# Open Mic: beat download → song upload → voter playback #06 — design

**Date:** 2026-11-19
**Status:** Approved by the owner (three decisions taken in-session, then "take charge, continue and complete the task in one sweep").
**Successor to:** [2026-11-10-open-mic-competition-steps-design.md](./2026-11-10-open-mic-competition-steps-design.md), which shipped the beat *reader* and the marketing-page steps. This spec closes the loop the earlier one deliberately left out: the applicant's side.

## Goal

An Open Mic applicant can, in order:

1. register and pay the entry fee (already works),
2. **hear and download the official beat** once the edition publishes one,
3. after the admin **approves** them, **upload the song they made on that beat**,
4. and from that moment the song is playable by *anyone* — the contestant's own profile, the web voting page, and the mobile Connect voting screen — which is what fans share and vote on.

It must work end to end **on localhost**, in the mobile app, on `frontend-web` and in `frontend-admin`.

## Verified current state

Read from `origin/main` at `5e175656d` on 2026-11-19. The three symptoms the owner reported are three separate defects, not one missing feature.

**The Open Mic contest has two identities.** `frontend-web/src/features/registration/reference-data.ts:210-228` declares the catalog entry `slug: 'open-mic-competition'` with `contestType: 'public_voting_contest'`, and `src/server/registration-v2/publish-to-voting.ts:69` writes that value into `contests.contest_type` when a registration is promoted. Every Open Mic route reads with `.eq('contest_type', 'one_beat_one_verse')` (`src/server/openmic/persistence.ts:352,601,643`). So the row an applicant is registered against and the row an admin creates in the Open Mic console — the one that can hold a `competition_beats` row — are different `contests` rows. A beat uploaded by an admin attaches to a contest the applicant is never told about.

**The song pipeline has no local-disk branch.** `app/api/registration/uploads/route.ts` and `app/api/open-mic/beats/[fileKey]/route.ts` both degrade to `saveLocalUpload`/`readLocalUpload` when `hasR2Config()` is false. The song side does not: `uploads/presign/route.ts:53` calls `createR2UploadUrl()` unguarded, `uploads/route.ts` is a blanket `410`, `songs/[id]/route.ts:38` returns `404 'Audio not available'` when R2 is absent, and `app/api/admin/open-mic/submissions/[id]/song/route.ts` mints a signed URL with no fallback. `frontend-web/.env.local` carries the Supabase trio and **no `R2_*` names**, so on localhost every one of those four is a dead end.

**Voters have nothing to play.** `app/api/vote-page/route.ts:79` selects `media_url` and then hardcodes `audioUrl: null` at :172. `mobile-app/reactnative/app/voting/contestant-profile.tsx:80-91` hands `media_url` to `Linking.openURL` — it leaves the app rather than playing — and `contestants.media_url` is documented as an external performance-sample link, so overloading it with a song key would be wrong for every other contest.

**Approval is not actually gating submission.** `createSubmission` (`persistence.ts:1243-1246`) only enforces approval when a `competition_enrollments` row is found by stage-name/email. An applicant who registered through the registration plane has no enrollment, so `linkedApplication` is `null` and the gate passes. Nothing in the upload path checks approval at all.

**Two windows, two answers.** `persistence.isWithinWindow` (:73-79) treats "neither bound configured" as **open**; `presign.isSubmissionWindowOpen` (:10-19) treats it as **closed**. The same edition can therefore accept a `createSubmission` and refuse a presign.

**The join key that makes the merge cheap.** `competition_beats`, `competition_enrollments` and `competition_entries` all FK `public.contests(id)`; `contests` and `connect_contests` are mirrored twins sharing one primary key (`20261223000000_connect_contests_bridge.sql`); and `promote_registration_to_contestant()` writes `contestants.user_id` alongside both `contest_id` and `connect_contest_id`. So `(contestants.connect_contest_id, contestants.user_id) → competition_entries (competition_id, user_id, status)` already connects a voter-facing roster row to a contestant's uploaded song **with no migration**.

## Decisions

### D1 — One Open Mic contest, not two

`reference-data.ts`'s Open Mic entry becomes `contestType: 'one_beat_one_verse'`, and `publish-to-voting.ts` stops rewriting a row that is already `one_beat_one_verse`. Registration, the admin Open Mic console, and Connect voting then address the same `contests.id`.

`createSubmission` and `recordSubmissionUploadComplete` both write `competition_entries`, which the earlier spec already established as the Open Mic entry table, so no new table and no new column is needed for storage.

**Row-level reconciliation is out of scope** (see *Out of scope*). The code change makes new promotions land on the right row; a one-off data pass to fold any already-duplicated prod rows is the owner's call.

### D2 — The song lives in `competition_entries`, exposed through the roster

Storage stays as-is: `competition_entries.lyrical_concept_summary` JSON carries `songObjectKey`/`r2ObjectKey`/`songFileName`/`mimeType`/`uploadStatus`. `mapSubmissionRow` (:265-267) already resolves the public reader `/api/open-mic/songs/<entry id>` whenever an object key exists — that path becomes the single playback URL for web and mobile alike.

Voters see it through a **new** roster field rather than a repurposed one: the Go connect roster gains `song_url` and `song_status`, produced by a `LEFT JOIN LATERAL` onto `competition_entries`. `contestants.media_url` keeps meaning what it says.

### D3 — Mobile plays audio with `expo-audio`

`expo-audio` (SDK 54's AV successor) is added so playback stays inside the app, with `useAudioPlayer` + `AudioPlayer.play()`/`pauseToPosition()`. `expo-file-system` ~19 and `expo-sharing` ~14, both already installed, cover the beat download. No new native module beyond the Expo SDK's own, so a dev-client rebuild suffices and no config plugin is needed.

### D4 — Approval gates upload, decided in one place

A new pure module `src/server/openmic/submission-eligibility.ts` owns the answer to "may this user hand in a song for this contest *now*".

```ts
type EligibilitySource = 'promoted' | 'enrollment' | 'registration' | 'none';
type EligibilityReason = 'ok' | 'signed_out' | 'not_approved' | 'window_closed';

getSongSubmissionEligibility({ contest, userId }): Promise<{
  eligible: boolean; source: EligibilitySource; reason: EligibilityReason;
  submissionOpensAt: string | null; submissionDeadline: string | null;
}>
```

Checked in order, first hit wins: a `contestants` row for `(contest.id ∪ contest.connectContestId, user_id)` — that row only exists because approval created it — then an approved `competition_enrollments` row for the same user, then a `registration_applications` row for this user whose status is in the promoting set (`approved`, `selected_for_public_voting`, `selected_for_bootcamp`). The registration-plane check is what closes the bypass above.

`presign` (new), the direct-upload sink, `complete` and `createSubmission` all consult it; `createSubmission` keeps its existing enrollment lookup for the payment/fee check it already does. The registration-plane check is what closes the bypass above. `OpenMicContest` carries no connect-plane key, so the resolver matches `contestants` on **both** `contest_id` and `connect_contest_id` and accepts either the row id or the slug — during the merge window a promoted contestant may hold either.

### D5 — One window rule, the strict one

`src/server/openmic/submission-window.ts` (already written) exports `isSubmissionWindowOpen` / `describeSubmissionWindow` with presign's semantics: force-open on `status === 'submission_open'`, otherwise a configured bound must cover now, and **no bounds means closed**. Rationale: an edition with no submission deadline configured is a misconfiguration, and a song accepted outside the window is one the admin did not schedule. `presign` and `createSubmission` both import it; the verdict's `reason` lets a screen say "submissions open on …" instead of showing a dead button.

**Operational consequence:** an admin must set `sponsor_assets.submissionStartAt/EndAt` in the Open Mic console, or flip the edition to `submission_open`. The admin editor gains a visible note saying so when the window is unset.

### D6 — Storage is a branch, not a rewrite

`hasR2Config()` stays the single switch. The song object key moves to one builder — `src/features/openmic/song-storage.ts` (already written) — replacing the three copies of `openmic/${slug||id}/${userId}/${submissionId}.mp3` (presign:51, complete:27, persistence:1302/1432). When R2 is absent:

- `presign` answers `{ mode: 'direct', uploadUrl: '/api/open-mic/uploads', method: 'POST', fieldName: 'file' }` instead of a signed PUT;
- `uploads/route.ts` stops being a blanket `410` and becomes the multipart sink (`saveLocalUpload`), keeping the `410` **when R2 is configured** so a production host never becomes an unintended file server;
- `complete` asserts existence through a storage-agnostic `songObjectExists()` — `assertR2ObjectExists` or `statLocalUpload` — and returns the reader path as `signedUrl`;
- `songs/[id]` streams from disk with the same `Range`/`206` + CORS behaviour it already gives R2, via the new `readLocalUploadRange`;
- the admin song getter takes the same branch.

Both modes carry the file-type rule from `registration/uploads` (SEC-007): the served `Content-Type` comes from the server's extension map, never from a client-supplied type.

## Interface

| Surface | Change |
|---|---|
| `GET /api/open-mic/contests/[slug]` | unchanged — already returns the edition with its `beat` block (preview/download reader paths, `allowDownload`, `usageRules`) |
| `GET /api/open-mic/contests/[slug]/beat/download` | unchanged contract; now also writes `logBeatDownload` so the admin's download list is real |
| `POST /api/open-mic/uploads/presign` | `upload.mode` = `'presigned'` \| `'direct'`; both carry `submissionId`, `objectKey`, `readerUrl`, `maxBytes` |
| `POST /api/open-mic/uploads` | multipart sink in direct mode (`file`, `submissionId`, `contestSlug`); `410` in R2 mode |
| `POST /api/open-mic/uploads/complete` | storage-agnostic existence assert; eligibility gate; `upload.signedUrl` = reader path locally |
| `GET /api/open-mic/songs/[id]` | public ranged reader, R2 **or** local disk |
| `GET /api/open-mic/me/eligibility` | **new** — `{ eligible, source, reason, submissionOpensAt, submissionDeadline, beatAvailable }` for the mobile/web applicant UI |
| `GET /api/admin/open-mic/submissions/[id]/song` | local branch |
| `POST /api/admin/open-mic/submissions/[id]/review` | exists; gets an admin-console caller (D7) |
| `GET /api/vote-page` | `audioUrl` resolved from the roster's `song_url`; relative paths made absolute against `NEXT_PUBLIC_SITE_URL` |
| Go `GET /api/v1/connect/contests/:id/roster` | `RosterEntry` gains `song_url`, `song_status` |

Mobile screens, all reachable from the existing registration-status timeline (`app/registration/[id]/status.tsx:103` already renders `ContestVotingCard`, whose copy already promises "complete your submission by beat/song submission"):

- `app/openmic/beat.tsx` — play the beat (`expo-audio`), then download (`expo-file-system` `downloadFileAsync` + `expo-sharing`); shows the usage rules and the terms checkbox before downloading.
- `app/openmic/song.tsx` — gated on eligibility. Pick audio (`expo-image-picker`'s document picker is not available, so `expo-document-picker` is used for `.mp3`), tick the three declarations, upload, then `complete`.
- `app/voting/contestant-profile.tsx` — a `SongPlayer` card in place of the `Linking.openURL` row when `song_url` is present, with the old external-sample link retained for contests that have one.

Relative audio paths are resolved to absolute on mobile through the existing `resolveApiBaseUrl()` + `getDevUrl()` helpers, because a device cannot reach `localhost`.

## Data flow

Uploading a song, R2 absent:

```
mobile/web ──POST presign──▶ eligibility ✓ window ✓ ──▶ {mode:'direct', uploadUrl}
           ──POST uploads (multipart)──▶ saveLocalUpload(openmic/<contestRef>/<user>/<id>.mp3)
           ──POST complete──▶ statLocalUpload ✓ ──▶ upsert competition_entries (status 'draft')
           ──POST submissions (declarations)──▶ status 'published_for_voting'
voter ──GET /api/open-mic/songs/<id>──▶ entry.status ∈ allowlist ──▶ 200/206 audio/mpeg
```

Voter-side lookup (web and mobile both):

```
contestants (connect_contest_id, user_id)
   └─ LEFT JOIN LATERAL competition_entries
        ON competition_id = contestants.contest_id AND user_id = contestants.user_id
       AND status IN ('submitted','published_for_voting','live_for_voting','finalist','winner')
      ORDER BY submitted_at DESC NULLS LAST LIMIT 1  →  lyrical_concept_summary->>'songObjectKey'
```

The reader route re-checks the status allowlist from the entry row itself, so a roster cache can never grant access to a rejected entry.

## Error handling

- Storage not configured is never an error any more — it selects a mode. A real R2 failure in R2 mode still surfaces as `502` with the reason logged server-side and not echoed (fs/SDK errors carry paths and config).
- Closed window returns `403` with `{ reason, submissionOpensAt }`; not approved returns `403 { reason: 'not_approved' }` so mobile can render "waiting on approval" rather than a failure.
- A stale or foreign `objectKey` at `complete` is `403` (unchanged), and the new validator also rejects `..`, backslashes, wrong segment count and non-UUID stems.
- Oversize song (> 50 MB) and non-`.mp3` are `400` at both presign and the sink.
- `songs/[id]` with no key, or an entry outside the allowlist, is `404`; a Range the file cannot satisfy is `416` with `Content-Range: bytes */<total>`.

## Testing

vitest runs `environment: 'node'`, so component rendering is proven in the browser and logic lives in plain modules. New unit files (not in any CI lane's include list, per the 2026-11-10 plan's note — run them explicitly; CI still proves them through `tsc`, lint and build):

- `tests/unit/openmic/submission-window.spec.ts` — force-open status, both bounds, one bound, no bounds → closed, malformed dates.
- `tests/unit/openmic/song-storage.spec.ts` — key builder round-trip, validator against traversal/segment/extension/UUID attacks.
- `tests/unit/openmic/song-upload-direct-mode.spec.ts` — the sink stores under the expected key, refuses a non-mp3, refuses over the cap, refuses when R2 *is* configured; `complete`'s existence assert.
- `tests/unit/openmic/song-reader-route.spec.ts` — whole-file `200`, `206` for `bytes=0-1023`, `416` past the end, `404` for a status outside the allowlist.
- `tests/unit/openmic/submission-eligibility.spec.ts` — one case per source plus the signed-out and not-approved paths.
- Go: `backend/internal/connect/voting` roster test asserting `song_url` is populated for an approved entry and null otherwise.
- Mobile: `tests/unit/openmic/*.spec.ts` for the API client's URL resolution and the eligibility→UI-state mapping, wired to a `test:openmic` script.

Manual localhost pass (R2 unset, Supabase local), the acceptance test for the owner's report:

1. admin creates/publishes an edition, uploads a beat, sets the submission window;
2. applicant registers and pays ₦2,000;
3. applicant plays the beat, downloads it — `beat_download_logs` gains a row;
4. upload presign **before** approval → `403 not_approved`;
5. admin approves → promotion creates the `contestants` row;
6. applicant uploads an mp3 → `complete` → `createSubmission`;
7. voter plays the song on `/voting/contestant-profile` (mobile) and on the web vote page;
8. admin reviews the song (approve/reject with feedback) and a rejected song stops playing.

## Out of scope

- Reconciling already-duplicated `contests` rows in any environment (a data pass, not code).
- The broader three-plane voting consolidation ADR-PR482 defers.
- Wave/split/pricing rule changes; payments beyond the existing fee.
- Any production deploy. `frontend-web` on `www.spotlightng.com` auto-publishes from a push to `main` in ~7 minutes, so merging this branch is itself a release action and needs the owner's explicit go-ahead.
- Non-mp3 song formats, multi-song entries, per-entry artwork.

## Risks and follow-ups

1. **Flipping `contestType` changes which row promotion writes.** If prod already has both rows with entrants on each, promotion will start landing on the beat-bearing row and existing contestant rows stay put. Mitigation: the slug-tolerant readers added here, and the eligibility check unioning `contestants.contest_id` with `connect_contest_id`.
2. **Strict-by-default submission windows can lock an edition out of uploading** if nobody configures dates. Surfaced deliberately (D5's operational note, the admin hint, and `reason`-carrying 403s) rather than papered over.
3. **Local disk is ephemeral** — `/tmp` is reaped, so a dev-uploaded song disappears on reboot. Accepted for a dev-only branch; R2 remains the production plane.
4. **`getContestById` has no type filter** (`:612`) while `getContestBySlug` does. Left as-is: the by-id path is admin-scoped and intentionally type-agnostic, and tightening it would break the cross-type admin console. Worth revisiting with the plane consolidation.
5. **Metro/Playwright staleness traps** in this repo (a warmed bundle served from a peer session) mean the browser leg of the manual pass must be run from a known tree with `CI=1`.
