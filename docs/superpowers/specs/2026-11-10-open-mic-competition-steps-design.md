# Open Mic competition steps #02–#05 — design

**Date:** 2026-11-10
**Status:** Approved direction (placement, edition data, wiring depth). Not started.
**Scope:** making the "Competition route" steps on `/service-details/open-mic-competition` real — a downloadable/playable official beat, and live hand-off into the existing `/open-mic/[slug]/*` app plane for submission, share/vote and leaderboard. Next.js only; no Go backend change, no migration, no production data write.

## Goal

An artist arriving on the Open Mic programme page can, in order: hear and download the official mp3 beat for the current edition; submit their own mp3 through the existing entry form; find their entry's share link once it is live; and see who is currently winning, with a vote CTA per contestant — without any step on that page being a prose sentence that points at nothing. Where the platform cannot yet honour a step (no edition published, window closed, visitor not signed in), it says so honestly instead of showing a control that fails.

## Verified current state

**The marketing page is inert.** `frontend-web/app/service-details/open-mic-competition/page.tsx` is a single 701-line `'use client'` file. The five stages are prose strings (`:8-39`); the accordions render only `description` and `preparation` (`:557-580`); CTAs go to `/apply` (`:485`, `:507`, `:681`) and — wrongly — to `/voting`, which is the STEM plane (`:684`). Its `layout.tsx` is metadata only (30 lines).

**The app plane already implements #03–#05.**
- *Submission:* `components/openmic/OpenMicEntryForm.tsx:124-191` presigns via `POST /api/open-mic/uploads/presign` (`.mp3` + `audio/mp3` only, 50 MB cap, key `openmic/<contestId>/<userId>/<submissionId>.mp3`), `PUT`s the file straight to storage, confirms with `/uploads/complete`, then `POST /api/open-mic/submissions` (`:219-244`). Beat download from that form is a plain anchor click on the GET route (`:91-110`).
- *Share:* `components/openmic/OpenMicArtistVotingCard.tsx:34-57` — copy, WhatsApp and X intents over the entry URL, plus the vote CTA and `<audio>` at `:162-168`.
- *Leaderboard:* `components/openmic/OpenMicEntriesBoard.tsx` — rank badges (`:106-110`), live counts over SSE (`:191-206`), per-row Vote (`:149-161`) and a details link per row (`:165`).
- *Reads:* `getLeaderboard` (`src/server/openmic/persistence.ts:1650-1667`) selects `competition_entries` in the voting statuses, ordered by `leaderboard_score` then `public_vote_count`, and returns `[]` when the DB is not configured (`:1651`).

**The beat is broken, and the route is not the cause.** Both admin surfaces upload the beat through `POST /api/registration/uploads` and store the returned `previewUrl` as the beat's download URL (`OpenMicAdminContestBuilder.tsx:87-115`, `OpenMicAdminContestEditor.tsx:58-80`; the builder also *requires* that field, `:83`). That URL is served by `app/api/registration/uploads/[fileKey]/route.ts`, which returns 401 without a bearer (`:20-25`) and 403 unless the requester is the uploader, because keys are namespaced `registration/<userId>/…` (`:32-37`). So the `<audio src={contest.beat.previewUrl}>` on `app/open-mic/[slug]/page.tsx:95-99` and the 302 in `app/api/open-mic/contests/[slug]/beat/download/route.ts:21` both fail for every artist but the admin. The download route itself is sound: it enforces `allowDownload`/`previewOnly` (`:13-15`), keeps the terms gate and `beat_download_logs` on its POST (`:27-63`), and already resolves a *relative* `downloadUrl` against `NEXT_PUBLIC_SITE_URL` (`:20-21`).

**Columns in play, no schema gap.** `competition_beats.preview_url` / `download_url` are plain text, written verbatim from the payload (`persistence.ts:848-861`, read back at `:215-232`, where `allowDownload = beat.is_active === true` and `requiresPaidEntryForDownload = beat.requires_enrollment`). Nothing here needs a new column.

**A proven pattern to copy.** Contest banners are exactly this problem, solved: `app/api/admin/contests/banner/route.ts:34-95` accepts multipart for admins and writes under a public prefix; `app/api/admin/contests/banner/[fileKey]/route.ts` is a **public, unauthenticated** reader whose `PUBLIC_PREFIXES` allowlist (`:16`) means it cannot be pointed at private registration documents sharing the bucket, and which streams from the local disk when R2 is unconfigured (`:33-46`) or 302s to a short-lived signed GET otherwise (`:54-59`).

**Storage helpers available today.** `src/lib/storage/r2.ts`: `hasR2Config` (`:22-29`), server-side `uploadR2Object` (`:121-135`), `createR2DownloadUrl` with an `inline|attachment` disposition (`:91-108`), `sanitizeObjectFileName` (`:60-68`). `src/lib/storage/local-uploads.ts`: `saveLocalUpload` (`:54`), `readLocalUpload` (`:60`), `contentTypeForKey` (`:49`). `frontend-web/.env.local` carries the Supabase trio but **no R2 variables**, so locally `hasR2Config()` is false and the local-disk fallback is the dev path.

**No edition exists.** Against the local dev database, `contests` holds only `contest_type='general'` rows, `competition_beats` has 0 rows and `competition_entries` has 0 rows. `app/open-mic/page.tsx:75-92` therefore shows "No Live Edition Right Now", and `app/apply/open-mic-competition/page.tsx` redirects to `/open-mic` rather than into a flow.

**Slug rule.** The canonical artist slug is `slugifyArtist` (`src/features/openmic/workflow.ts:70-77`); the entry page matches on it (`app/open-mic/[slug]/entry/[artistSlug]/page.tsx:18`) and the board builds links with an identical private copy (`OpenMicEntriesBoard.tsx:28-33`). `src/server/openmic/store.ts:79-85` has a third variant that maps punctuation to `-` instead of deleting it, so a name like `K1ng$hoota` yields `k1nghoota` in the link and `k1ng-hoota` in the lookup — divergent, but only reachable on the in-memory no-DB fallback.

## Decisions

**A. Wire, do not duplicate.** The programme page keeps no uploader, no vote modal and no payment rail. It plays and hands over the beat, then deep-links into `/open-mic/<slug>/*` for everything that touches money. One implementation of submission and voting stays in the repo.

**B. The beat file moves to a public, prefix-locked plane.** New `POST /api/admin/open-mic/beats` (admin-gated, multipart, `.mp3`/`audio/mp3`, 50 MB cap shared with the submission presign) writes server-side via `uploadR2Object` to `openmic-beats/<contestId>/<uuid>.mp3`, falling back to `saveLocalUpload` when `hasR2Config()` is false. It responds with the two relative reader paths for the caller to store.

**C. One public reader, two dispositions.** New `GET /api/open-mic/beats/[fileKey]` — no auth, `openmic-beats/` allowlisted exactly as the banner reader allowlists its prefixes, 404 (never 403) for anything else so the route cannot probe the shared bucket. Default `Content-Disposition: inline` for the `<audio>` element; `?download=1` sets `attachment` with a filename derived from the beat title through `sanitizeObjectFileName`. Cache `public, max-age=31536000, immutable`: the uuid in the key makes a given URL permanently address the same bytes.

**D. The stored value changes, the columns do not.** After a successful upload the admin form stores `preview_url = /api/open-mic/beats/<encoded key>` and `download_url = /api/open-mic/beats/<encoded key>?download=1`. Because they are root-relative, the download route's existing `new URL(downloadUrl, siteUrl)` resolution makes them correct on every origin — the failure mode that motivated storing paths rather than absolute URLs in the first place. No migration, no new column, no read-time signing change in `persistence.ts`.

**E. Legacy rows are named, not hidden.** A stored URL that still points at `/api/registration/uploads/` is known-broken for artists. Public surfaces treat that beat as unavailable: no player, no download button, copy that the beat is on its way — never a control that 401s. The admin builder and editor show a warning on such a row ("this beat predates the public-beat storage fix; re-upload it"), which is the only path that actually repairs an existing edition.

**F. Server reads once, client renders.** `page.tsx` becomes a server component that resolves the active edition, reads its beat and `getLeaderboard`, and passes a serialisable `edition` prop into a client view that holds today's markup. This keeps the hash-to-accordion behaviour (`page.tsx:455-466`), the lounge `<dialog>` and the carousel exactly as they are while letting the page read the database. `metadata` stays in `layout.tsx`.

**G. The active edition has one definition.** `listContests` (`src/server/openmic/persistence.ts:345-364`) already restricts rows to `contest_type = OPEN_MIC_CONTEST_TYPE` (`:352`), drops `visibility === 'hidden'` unless `includeNonPublic` is passed (`:356`) and returns `[]` when Supabase reads are not configured (`:346`). A new `getActiveOpenMicEdition()` in `src/features/openmic/active-edition.ts` therefore adds exactly one thing — the status allowlist `registration_open`, `published`, `submission_open`, `voting_live` — and returns the first match (newest first) or `null`. It deliberately does **not** copy `app/apply/open-mic-competition/page.tsx`'s `|| contests[0]` fallback, which redirects people to an `ended` or `draft` edition when nothing is live; that page adopts this selector so "the current edition" means one thing on every surface.

**H. Step-by-step content.**

| Step | Live content | Hand-off |
|---|---|---|
| 01 Register as an artist | edition title, registration window, paid/free registration as configured | `/open-mic/<slug>/apply` |
| 02 Get the Spotlight beat | inline player on the reader URL, Download mp3 button, producer credit, usage rules | same URL, `?download=1` |
| 03 Make and submit a song | submission window with open/closed state, format and size limits stated from the real cap | `/open-mic/<slug>/enter` |
| 04 Share and rally votes | the signed-in visitor's own live entry link and its vote count; otherwise the honest "appears when your entry is live" | `/api/open-mic/submissions` client-side, already scoped to `userId` |
| 05 Leaderboard | top 5: rank, artist, song, vote count; edition entry count and total votes — subject to the two `votingConfig` switches below | per-row Vote CTA → `/open-mic/<slug>/entry/<artistSlug>`, that contestant's own voting page (the existing plane's artist card hosts the vote modal, so the CTA lands where a vote for *that* artist can actually be cast); the panel-level "Vote now" and "Full leaderboard" → `/open-mic/<slug>/entries`. Every one of those affordances, panel-level or per-row, exists only while `leaderboardVisible` is on — hidden standings mean no links into them, not links next to a note saying they are private. |

The bottom "Go to voting" CTA (`page.tsx:684`) repoints from `/voting` to the edition's board, falling back to `/open-mic` when there is no edition.

**H2. Admin display switches are honoured, not overridden.** `OpenMicVotingConfig` already carries `leaderboardVisible` and `voteCountPublic` (`src/features/openmic/types.ts:94-95`). When the leaderboard is hidden the step 05 preview renders only the private-standings note — no board, and no "Full leaderboard" hand-off beside it, because a link to the full standings would refute the sentence printed above it. When `voteCountPublic` is off the preview shows ranks without numbers, and the server leaves those numbers out of the payload entirely rather than shipping them for the client to hide (a value in the RSC payload is delivered, not displayed). The server resolves both switches into `showLeaderboard` / `showVoteCounts`, so the client branches on the resolved booleans and on `null` counts, never on `votingConfig`. Enforcing the same two switches inside the existing `/open-mic/<slug>/entries` board is deliberately out of scope here (decision A wires that plane, it does not change it) and is recorded as follow-up work.

**I. The new link builder uses the canonical slug.** Every artist URL minted by this work goes through `slugifyArtist`, never a local copy, so a preview link cannot disagree with the entry page's lookup.

**J. Dev-only proof data.** Verification runs against rows inserted straight into the local dev Supabase: one contest with `contest_type = OPEN_MIC_CONTEST_TYPE`, slug `open-mic-dev`, status `voting_live`, all windows spanning today, and `votingConfig` with `leaderboardVisible` and `voteCountPublic` both true; five `competition_entries` rows in `published_for_voting` with distinct `public_vote_count`; and one beat mp3 written **through the new admin route**, so the new path is exercised rather than the seeded one. No migration and no production write: prod keeps zero editions until Spotlight publishes one in the admin console. These local rows stay for the user to click through and are named here so they are not mistaken for real programme data.

## Interface

**`POST /api/admin/open-mic/beats`** — admin session required, mirroring the banner upload's guard. Multipart field `file`. Accepts `audio/mp3` with an `.mp3` name up to 50 MB; anything else 400. Requires a `contestId` query or field so the key can be namespaced. `201 { success: true, beat: { objectKey, previewUrl, downloadUrl, fileName, sizeBytes } }`. Errors: 401 not signed in, 403 not an admin, 400 bad type or size, 502 storage unavailable.

**`GET /api/open-mic/beats/[fileKey]`** — public. `fileKey` is base64url of the object key, same encoding the banner and registration readers already use. Non-`openmic-beats/` prefix or a `..` segment → 404. Local fallback → the stored buffer with `contentTypeForKey`. R2 → `HeadObject` existence check, then 302 to `createR2DownloadUrl`. `?download=1` → `Content-Disposition: attachment`, otherwise `inline`.

**Components touched or added.**

| File | Change |
|---|---|
| `app/service-details/open-mic-competition/page.tsx` | becomes a server component: resolve edition + beat + leaderboard, render `<OpenMicCompetitionView>`; static stage copy moves out |
| `components/openmic/competition/OpenMicCompetitionView.tsx` | `'use client'` shell carrying today's markup, hero, stats, paper, lounges, closing band; `edition` prop |
| `components/openmic/competition/OpenMicEditionSteps.tsx` | `'use client'` — the five accordions with live content, the beat player, the download button, the top-5 board |
| `components/openmic/competition/OpenMicLoungeApplication.tsx` | moved verbatim from `page.tsx:180-311` so no file grows past ~400 lines |
| `components/openmic/competition/OpenMicTestimonials.tsx` | moved verbatim from `page.tsx:41-141,313-450` |
| `src/features/openmic/active-edition.ts` | `getActiveOpenMicEdition()` + the `OpenMicEditionStepsData` type |
| `app/apply/open-mic-competition/page.tsx` | uses the shared selector; loses its `|| contests[0]` fallback to an ended edition |
| `app/api/admin/open-mic/beats/route.ts` | new |
| `app/api/open-mic/beats/[fileKey]/route.ts` | new |
| `components/openmic/OpenMicAdminContestBuilder.tsx:87-115` | upload target → `/api/admin/open-mic/beats`; stores relative reader paths; legacy-URL warning |
| `components/openmic/OpenMicAdminContestEditor.tsx:58-80` | same |
| `app/open-mic/[slug]/page.tsx:95-99` | player uses the same availability rule as decision E |

`OpenMicEditionStepsData` (serialisable, no `Date` objects). `OpenMicContest` declares its window fields as optional (`types.ts:153-156`) and puts the voting window on `votingConfig` (`:100-101`), so the server normalises every `undefined` to `null` and the client only ever has to test for `null`. Which side of each window the clock is on is resolved by the same read, against one instant — the browser computes nothing during render, because the HTML is written at request time and the first client render happens later:

```ts
type WindowState = 'open' | 'not-started' | 'closed' | 'unknown';

type OpenMicEditionStepsData = {
  id: string; slug: string; title: string; status: string;
  registrationStartAt: string | null; registrationEndAt: string | null;
  registrationState: WindowState;
  submissionStartAt: string | null; submissionEndAt: string | null;
  submissionState: WindowState;
  votingStartAt: string | null; votingEndAt: string | null;
  votingState: WindowState;
  registrationFeeNgn: number; entryFeeRequired: boolean;
  showLeaderboard: boolean; showVoteCounts: boolean;
  beat: null | {
    title: string; producerCredit: string; usageRules: string;
    previewUrl: string | null; downloadUrl: string | null;
    downloadable: boolean; requiresPaidEntry: boolean;
  };
  // `null` is "the board could not be read", not "0 entries" — a different
  // fact, and no branch may print a number for it.
  board: null | {
    rows: { rank: number; artistSlug: string; stageName: string; songTitle: string; voteCount: number }[];
    entryCount: number; totalVotes: number;
  };
};
```

`beat.previewUrl` is `null` whenever the stored value is absent or a legacy owner-only path — the server decides availability so no client has to re-derive it.

## Data flow

1. Request hits `/service-details/open-mic-competition` → `getActiveOpenMicEdition()` → on an edition, `getContestBySlug` supplies the beat row and `getLeaderboard(contest.id)` the top rows; the server maps both into `OpenMicEditionStepsData`, reading `votingConfig.leaderboardVisible` / `voteCountPublic` into `showLeaderboard` / `showVoteCounts`, truncating the board to 5 and totalling votes.
2. The beat `<audio>` fetches `/api/open-mic/beats/<key>` (inline, public); "Download mp3" fetches the same URL with `?download=1`, which is the same file the `/beat/download` route 302s to, so the terms gate and `beat_download_logs` keep their existing owner.
3. Step 04 renders server-side as the honest line; when a Supabase session exists the client calls `GET /api/open-mic/submissions?contestId=<id>` — the id from `OpenMicEditionStepsData.id`, and the route already filters to the bearer's `user.id` (`route.ts:9-11`) — and swaps in its own entry link plus count.
4. Voting and submission never happen here; they happen on `/open-mic/<slug>/enter` and `/open-mic/<slug>/entries`, whose code this design does not modify.

## Error handling

- **No edition** → steps show their editorial copy with one "next beat drops soon" panel and the dashboard CTA. No disabled-looking dead buttons.
- **Beat missing or legacy-path** → no player, no download control (decision E), and the admin surfaces say why.
- **`previewOnly` or `allowDownload === false`** → player only; download control absent rather than disabled.
- **`requires_enrollment`** → step 02 states that the beat unlocks after approved entry, and its CTA is the apply page, not a download.
- **Submission window closed** → step 03 shows the dates and links to the board instead of the entry form.
- **Not signed in at step 04** → explanatory line plus the apply link; never a fabricated link.
- **Reader with a foreign or traversal key** → 404, so the route cannot be used to test whether private objects exist.
- **Storage failure** → the upload route 502s and the form keeps the previous value; nothing writes a half-configured beat URL.
- **Leaderboard hidden (`votingConfig.leaderboardVisible` false)** → step 05 shows no rows, only the hand-off; **counts hidden (`voteCountPublic` false)** → ranks, artist and song without numbers. Never a number the admin turned off.
- **`getLeaderboard` throws** → the page still renders; the read is wrapped so a DB error degrades to the empty state rather than an error boundary, matching its existing `[]` behaviour at `persistence.ts:1651`.

## Testing

- **Unit, `tests/unit/media/open-mic-beat-storage.test.ts`** — the reader's prefix allowlist (accepts `openmic-beats/…`, 404s `registration/…` and traversal), `?download=1` vs inline disposition, the upload route's type and size rejection, and the legacy-URL availability rule (a `/api/registration/uploads/` value yields `previewUrl: null`).
- **Unit, `tests/unit/openmic/active-edition.test.ts`** — `getActiveOpenMicEdition` picks the newest qualifying edition, ignores `ended`/`draft`/hidden, returns `null` when nothing qualifies; `undefined` window dates normalise to `null`; `showLeaderboard` / `showVoteCounts` come from `votingConfig`; the board truncates to 5 and totals votes.
- **E2E, `tests/e2e/openmic/competition-steps.spec.ts`** (run with `--workers=1`) against the `open-mic-dev` fixture — step 02's audio src resolves 200 with an audio content-type, the download control resolves 200 with `Content-Disposition: attachment`, step 03 links to `/open-mic/open-mic-dev/enter`, step 05 pins all five ranked rows by name, whole-number count and a Vote CTA into that contestant's own `/open-mic/open-mic-dev/entry/<artistSlug>`, with the panel-level "Vote now" going to `/open-mic/open-mic-dev/entries`, and no link on the page points at `/voting`.
- **Hand pass for the signed-in variant of step 04** with a minted dev session (per the project's local session-minting note); the spec above covers the signed-out honest line only, because this plane has no e2e auth helper and inventing one is out of scope here.
- **Browser pass, by hand** — desktop and 390 px, on `/service-details/open-mic-competition`, `/open-mic/<slug>` and both admin surfaces, with screenshots written to disk; plus one *real* admin re-upload of an mp3 so the new route is proven, not just the seeded row.
- **Gates on the exact tree** — `npx tsc --noEmit`, `npm run lint`, `npm run contract:check`, `vitest run tests/unit/config`, `npm run test:regression`, `npm run test:money`, `npm run build` with a scratch `DIST_DIR` so the shared dev server's `.next` is never clobbered.

## Out of scope

No migration or schema change; no production edition or any shared-DB test data; no Go backend work; no new upload, vote or payment UI; no change to `/voting` or the STEM plane; no change to the bespoke `openMic-header`/footer chrome on this page; no refactor of `OpenMicEntriesBoard` or `OpenMicArtistVotingCard`; no fix to the in-memory `store.ts` fallback plane beyond not depending on it.

## Risks and follow-ups

- **Existing editions stay broken until re-uploaded.** The fix is in the write path; an already-stored owner-only URL only becomes playable when an admin re-uploads. Decision E's warning is what makes that visible rather than silent.
- **`store.ts:79` slug divergence** remains on the no-DB fallback path. Harmless while Supabase is configured; worth one small change of its own if the fallback ever goes live.
- **Unrelated pre-existing bugs found while reading, reported not fixed:** the hamburger drawer's `.mean-nav` list renders off its own panel at 390 px on production; `src/components/Header.tsx:33` links to `/contestant-leaderboard`, which has no route; Footer2's dark-on-dark links; `components/sections/Service3.js:16` still links to the `/service` page being removed under task #127.
