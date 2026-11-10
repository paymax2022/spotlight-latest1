# Open Mic competition steps #02–#05 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the five "Competition route" steps on `/service-details/open-mic-competition` real — a publicly playable/downloadable official mp3 beat, and live hand-offs into the existing `/open-mic/[slug]/*` app plane for submission, share/vote and a top-5 leaderboard preview.

**Architecture:** The beat's bytes move to their own public, prefix-locked storage plane (an admin multipart upload plus one unauthenticated reader), and the contest row stores the *root-relative reader path* in the columns it already has. The marketing page becomes a server component that resolves the current edition once, maps it into a serialisable `OpenMicEditionStepsData`, and passes it to a client view; the five accordions render live state instead of prose. Submission, sharing and voting are not reimplemented — they are linked.

**Tech Stack:** Next.js 16 App Router, React 19.3.1, TypeScript, Supabase JS (`createAdminClient`), Cloudflare R2 SDK with local-disk fallback, vitest (node environment), Playwright.

**Spec:** [docs/superpowers/specs/2026-11-10-open-mic-competition-steps-design.md](file:///Users/paymax/Documents/spotlight/main/docs/superpowers/specs/2026-11-10-open-mic-competition-steps-design.md) — read it with this plan; it argues the decisions, this plan executes them.

## Global Constraints

- Everything lives in `frontend-web` inside the git repo at `/Users/paymax/Documents/spotlight/main`. The harness cwd resets after every shell call — always use absolute paths, and prefix repo-root-relative git paths with `frontend-web/`.
- **No migration, no DDL, no production write.** Local dev Supabase only. `frontend-web/.env.local` carries the Supabase trio and **no R2 credentials**, so `hasR2Config()` is false locally and the local-disk fallback (`/tmp/spotlight-registration-uploads`) is the dev path.
- **Never print the contents of `.env.local`** or any credential — presence/length only.
- **Other sessions are working in this tree.** `frontend-web/app/service-details/open-mic-competition/page.tsx` (+231 uncommitted lines) and `.../open-mic.css` carry an in-flight lounge-application feature, along with the untracked `frontend-web/app/api/open-mic/lounge-applications/`. Tasks 1–9 must not touch those files. Task 10 starts with a hard gate.
- Stage only this session's files, by explicit path, one commit per logical change. Never `git add -A`. Never stage `next-env.d.ts`. Do not push without the user's go-ahead.
- **Commit with an explicit pathspec** — `git commit -m "…" -- <the paths you staged>` — because this is a shared worktree where other sessions stage and commit while you work, and a plain `git commit` can sweep their staged files into your commit. Verify before and after with `git diff --cached --name-only -- <your paths>`. (At plan-execution time the previously staged `D frontend-web/app/service/page.js` was deliberately unstaged — its on-disk deletion stays in place for the `/service` task to re-stage — so the index is clean, but the pathspec rule still holds.)
- Copy rules: no dead affordances, no fabricated numbers. Where the platform cannot honour a step (no edition, window closed, signed out), say so plainly instead of showing a control that fails.
- vitest runs with `environment: 'node'` — there is no jsdom, so component *rendering* is proven by Playwright and component *logic* lives in testable plain modules.
- Playwright for this app must run with `--workers=1` (parallel workers hammer one `next dev` and false-fail on timeouts).
- The new `tests/unit/media` and `tests/unit/openmic` files are not in any CI lane's include list (`test:regression` = `tests/unit/golden-path`, `test:money` = estate/wallet/tiers, config lane = `tests/unit/config`). Run them explicitly; CI still proves them through `tsc` + lint + build. Widening a CI lane is out of scope.
- Content types are decided **server-side from the extension**, never from the client's `file.type` (SEC-007 precedent in `app/api/registration/uploads/route.ts:11-22`): an mp3 is always served `audio/mpeg`.

## File structure

| Path | Role | Created/modified in |
|---|---|---|
| `frontend-web/src/features/openmic/beat-storage.ts` | Object-key + reader-URL vocabulary and the legacy-availability rule. One place that knows what a beat URL looks like. | Task 1 |
| `frontend-web/app/api/open-mic/beats/[fileKey]/route.ts` | Public, unauthenticated beat reader. `openmic-beats/` allowlisted; 404 for anything else; `?download=1` → `attachment`. | Task 1 |
| `frontend-web/app/api/admin/open-mic/beats/route.ts` | Admin multipart mp3 upload; returns the two relative reader paths. | Task 2 |
| `frontend-web/app/open-mic/[slug]/page.tsx` | Edition page: beat player gated by the availability rule. | Task 3 |
| `frontend-web/src/features/openmic/active-edition.ts` | `getActiveOpenMicEdition()` (one definition of "current edition"), `buildOpenMicEditionStepsData()`, `loadOpenMicEditionSteps()`, `OpenMicEditionStepsData`. | Tasks 4–5 |
| `frontend-web/app/apply/open-mic-competition/page.tsx` | Uses the shared selector; loses `|| contests[0]`. | Task 4 |
| `frontend-web/components/openmic/OpenMicAdminContestBuilder.tsx`<br>`frontend-web/components/openmic/OpenMicAdminContestEditor.tsx` | Upload to the new route, store reader paths, warn on a legacy beat. | Task 6 |
| `frontend-web/tests/unit/media/open-mic-beat-storage.test.ts` | Reader allowlist, dispositions, upload validation, availability rule. | Tasks 1–3 |
| `frontend-web/tests/unit/openmic/open-mic-params.spec.ts` | Hermetic guard: every Open Mic page awaits `params`. | Task 3b |
| `frontend-web/tests/unit/openmic/active-edition.test.ts` | The edition selector, incl. the compile-time status-classification pin. | Task 4 |
| `frontend-web/tests/unit/openmic/edition-steps-data.spec.ts` | The steps view-model builder and loader. | Task 5 |
| `frontend-web/tests/unit/openmic/admin-beat-wiring.spec.ts` | Hermetic source guard for the two admin forms. | Task 6 |
| `frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx`<br>`.../edition-steps.module.css` | The five accordions with live content, beat player, own-entry lookup, top-5 board. | Task 9 |
| `frontend-web/app/service-details/open-mic-competition/page.tsx` | Server component: resolve data, render the view. | Task 10 |
| `frontend-web/components/openmic/competition/OpenMicCompetitionView.tsx` | `'use client'` shell carrying today's markup, moved verbatim. | Task 10 |
| `frontend-web/tests/e2e/openmic/competition-steps.spec.ts` | The five steps proven against the dev fixture. | Task 8 |

---

### Task 1: Beat storage vocabulary + the public reader

**Files:**
- Create: `frontend-web/src/features/openmic/beat-storage.ts`
- Create: `frontend-web/app/api/open-mic/beats/[fileKey]/route.ts`
- Test: `frontend-web/tests/unit/media/open-mic-beat-storage.test.ts`

**Interfaces:**
- Consumes: `readLocalUpload`, `contentTypeForKey` from `@/src/lib/storage/local-uploads`; `hasR2Config`, `assertR2ObjectExists`, `createR2DownloadUrl`, `sanitizeObjectFileName` from `@/src/lib/storage/r2`; `errorResponse`, `handleApiError` from `@/src/lib/api/responses`.
- Produces: `BEAT_OBJECT_PREFIX`, `BEAT_READER_BASE`, `LEGACY_UPLOAD_PREFIX`, `beatObjectKey(contestId, uuid)`, `encodeBeatFileKey(key)`, `decodeBeatFileKey(fileKey): string | null`, `isPublicBeatObjectKey(key): boolean`, `beatReaderUrl(objectKey, { download?: boolean })`, `publicBeatUrl(stored): string | null`, `isLegacyBeatUrl(stored): boolean`. Task 2 imports the key/URL builders; Task 3 and Task 5 import `publicBeatUrl`/`isLegacyBeatUrl`.

- [ ] **Step 1: Write the failing tests for the vocabulary and the reader**

Create `frontend-web/tests/unit/media/open-mic-beat-storage.test.ts`:

```ts
// The official Open Mic beat must play for an anonymous visitor, so its bytes
// live under their own public prefix instead of sharing the bucket with private
// registration documents (the old flow stored /api/registration/uploads/… keys,
// which 401/403 for every artist but the admin who uploaded them).
//
// Two things must not regress: the reader cannot be pointed at any prefix but
// `openmic-beats/`, and it never becomes an existence oracle for private
// objects (404, not 403).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readLocalUpload = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/storage/local-uploads', () => ({
  readLocalUpload,
  contentTypeForKey: (key: string) => (key.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream'),
}));

vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config: () => false,
  createR2UploadUrl: vi.fn(),
  uploadR2Object: vi.fn(),
  assertR2ObjectExists: vi.fn(),
  createR2DownloadUrl: vi.fn(),
  sanitizeObjectFileName: (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, '-'),
}));

import { GET } from '@/app/api/open-mic/beats/[fileKey]/route';
import {
  BEAT_OBJECT_PREFIX,
  BEAT_READER_BASE,
  LEGACY_UPLOAD_PREFIX,
  beatObjectKey,
  beatReaderUrl,
  decodeBeatFileKey,
  encodeBeatFileKey,
  isLegacyBeatUrl,
  isPublicBeatObjectKey,
  publicBeatUrl,
} from '@/src/features/openmic/beat-storage';

const get = (fileKey: string, query = '') =>
  GET(new Request(`https://web.example.test/api/open-mic/beats/${fileKey}${query}`), {
    params: Promise.resolve({ fileKey }),
  });

describe('beat storage vocabulary', () => {
  it('namespaces an object key under the public beat prefix', () => {
    expect(beatObjectKey('contest-9', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(
      `${BEAT_OBJECT_PREFIX}contest-9/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mp3`,
    );
  });

  it('mints root-relative reader URLs, with ?download=1 only for the download', () => {
    const key = beatObjectKey('contest-9', 'u1');
    expect(beatReaderUrl(key)).toMatch(new RegExp(`^${BEAT_READER_BASE}/[A-Za-z0-9_-]+$`));
    expect(beatReaderUrl(key, { download: true })).toBe(`${beatReaderUrl(key)}?download=1`);
    expect(beatReaderUrl(key)).not.toMatch(/^https?:/);
  });

  it('round-trips a key through base64url and rejects anything that is not exactly encoded', () => {
    const key = beatObjectKey('contest-9', 'u2');
    expect(decodeBeatFileKey(encodeBeatFileKey(key))).toBe(key);
    expect(decodeBeatFileKey('%%%')).toBeNull();
    expect(decodeBeatFileKey('')).toBeNull();
  });

  it('accepts only its own prefix and refuses traversal', () => {
    expect(isPublicBeatObjectKey('openmic-beats/c1/u.mp3')).toBe(true);
    expect(isPublicBeatObjectKey('registration/user-1/passport.png')).toBe(false);
    expect(isPublicBeatObjectKey('openmic-beats/../../registration/x.mp3')).toBe(false);
  });

  it('treats a legacy owner-only URL as unavailable and names it for the admin warning', () => {
    expect(publicBeatUrl(`${LEGACY_UPLOAD_PREFIX}abc`)).toBeNull();
    expect(publicBeatUrl('')).toBeNull();
    expect(publicBeatUrl(undefined)).toBeNull();
    expect(publicBeatUrl(`${BEAT_READER_BASE}/abc`)).toBe(`${BEAT_READER_BASE}/abc`);
    expect(isLegacyBeatUrl(`${LEGACY_UPLOAD_PREFIX}abc`)).toBe(true);
    expect(isLegacyBeatUrl(`${BEAT_READER_BASE}/abc`)).toBe(false);
  });
});

describe('GET /api/open-mic/beats/[fileKey]', () => {
  beforeEach(() => {
    readLocalUpload.mockReset();
  });

  it('serves a beat key inline with an audio content type and immutable caching', async () => {
    readLocalUpload.mockResolvedValue(Buffer.from([1, 2, 3]));
    const res = await get(encodeBeatFileKey('openmic-beats/c1/u.mp3'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('switches to an attachment disposition for ?download=1', async () => {
    readLocalUpload.mockResolvedValue(Buffer.from([1]));
    const res = await get(encodeBeatFileKey('openmic-beats/c1/u.mp3'), '?download=1');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('404s — never 403 — for any other prefix, so the route cannot probe private objects', async () => {
    for (const key of [
      'registration/user-1/passport.pdf',
      'contests/banners/abc.png',
      'openmic-beats/../../registration/passport.pdf',
    ]) {
      expect((await get(encodeBeatFileKey(key))).status).toBe(404);
    }
    expect(readLocalUpload).not.toHaveBeenCalled();
  });

  it('404s a missing file and a malformed key', async () => {
    readLocalUpload.mockResolvedValue(null);
    expect((await get(encodeBeatFileKey('openmic-beats/c1/gone.mp3'))).status).toBe(404);
    expect((await get('%%%')).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/media/open-mic-beat-storage.test.ts`
Expected: FAIL — `Failed to load /src/features/openmic/beat-storage` (module does not exist).

- [ ] **Step 3: Write the vocabulary module**

Create `frontend-web/src/features/openmic/beat-storage.ts`:

```ts
/**
 * Object keys and reader URLs for the Open Mic official beat.
 *
 * The beat has to play for an anonymous visitor on the programme page, so its
 * bytes get their own public prefix rather than sharing the bucket with private
 * registration documents. Reader URLs are ROOT-RELATIVE: the stored value is
 * read by the web app, the admin console and the Go voting API on three
 * different origins, and an absolute URL minted at upload time bakes that
 * environment's host into the row (the failure that made contest banners
 * unloadable anywhere but the laptop that uploaded them).
 */
export const BEAT_OBJECT_PREFIX = 'openmic-beats/';
export const BEAT_READER_BASE = '/api/open-mic/beats';

/**
 * Written by the old admin flow. The registration reader serves those keys only
 * to the account that uploaded them (403), or not at all (401 signed out), so an
 * edition carrying one has a beat nobody but the admin can hear.
 */
export const LEGACY_UPLOAD_PREFIX = '/api/registration/uploads/';

export function beatObjectKey(contestId: string, uuid: string) {
  return `${BEAT_OBJECT_PREFIX}${contestId}/${uuid}.mp3`;
}

export function encodeBeatFileKey(objectKey: string) {
  return Buffer.from(objectKey, 'utf8').toString('base64url');
}

/**
 * base64url decoding never throws — it yields garbage — so require an exact
 * round trip. `%%%` must not resolve to an object.
 */
export function decodeBeatFileKey(fileKey: string): string | null {
  if (!fileKey) return null;
  const decoded = Buffer.from(fileKey, 'base64url').toString('utf8');
  return encodeBeatFileKey(decoded) === fileKey ? decoded : null;
}

export function isPublicBeatObjectKey(key: string) {
  return key.startsWith(BEAT_OBJECT_PREFIX) && !key.includes('..');
}

export function beatReaderUrl(objectKey: string, opts: { download?: boolean } = {}) {
  const url = `${BEAT_READER_BASE}/${encodeBeatFileKey(objectKey)}`;
  return opts.download ? `${url}?download=1` : url;
}

/** The URL a public surface may use, or null when it cannot play or download. */
export function publicBeatUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return stored.startsWith(LEGACY_UPLOAD_PREFIX) ? null : stored;
}

export function isLegacyBeatUrl(stored: string | null | undefined): boolean {
  return Boolean(stored && stored.startsWith(LEGACY_UPLOAD_PREFIX));
}
```

- [ ] **Step 4: Write the reader route**

Create `frontend-web/app/api/open-mic/beats/[fileKey]/route.ts`. This mirrors `app/api/admin/contests/banner/[fileKey]/route.ts` — the proven public reader — with one prefix and a disposition switch:

```ts
import { NextResponse } from 'next/server';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config, sanitizeObjectFileName } from '@/src/lib/storage/r2';
import { contentTypeForKey, readLocalUpload } from '@/src/lib/storage/local-uploads';
import { decodeBeatFileKey, isPublicBeatObjectKey } from '@/src/features/openmic/beat-storage';

/**
 * Serve the official beat. PUBLIC by design: the artist hearing the beat before
 * registering is not signed in, and gating it on the upload permission would
 * mean only the admin who uploaded it ever hears it.
 *
 * Only `openmic-beats/` keys are served, and anything else is a 404 rather than
 * a 403, so this route cannot be used to test whether a private object (the
 * registration documents sharing this bucket) exists.
 */
export async function GET(request: Request, ctx: { params: Promise<{ fileKey: string }> }) {
  const { fileKey } = await ctx.params;
  // No decodeURIComponent: base64url is already URL-safe, and decoding twice
  // would throw on a hostile value instead of 404ing it.
  const objectKey = decodeBeatFileKey(fileKey || '');
  if (!objectKey || !isPublicBeatObjectKey(objectKey)) return new NextResponse('Not found', { status: 404 });

  const wantsDownload = new URL(request.url).searchParams.get('download') === '1';
  const disposition = wantsDownload ? 'attachment' : 'inline';
  const fileName = sanitizeObjectFileName(objectKey.split('/').pop() || 'beat.mp3');

  if (!hasR2Config()) {
    const buffer = await readLocalUpload(objectKey);
    if (!buffer) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        // Canonical, from the extension — never the uploader's client-supplied
        // type (SEC-007).
        'Content-Type': contentTypeForKey(objectKey),
        // Bare `inline` for playback — the `<audio>` element needs no filename,
        // and Step 1's assertion pins the header to exactly `inline`. Only
        // `attachment` carries a name, and because decision D stores nothing but
        // the encoded key, that name is the object's last segment (a uuid), not
        // the beat title: the reader has no database read, and it must not grow
        // one just to answer a download. A titled download stays available on the
        // terms-gated `/api/open-mic/contests/[slug]/beat/download` route, which
        // does know the title.
        'Content-Disposition': wantsDownload ? `attachment; filename="${fileName}"` : 'inline',
        // Public and immutable: the key carries a uuid, so a given URL always
        // addresses the same bytes.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  try {
    await assertR2ObjectExists(objectKey);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const signedUrl = await createR2DownloadUrl({ key: objectKey, fileName, disposition });
  return NextResponse.redirect(signedUrl, { status: 302 });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/media/open-mic-beat-storage.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx tsc --noEmit` — Expected: exit 0.

```bash
git -C /Users/paymax/Documents/spotlight/main add \
  frontend-web/src/features/openmic/beat-storage.ts \
  'frontend-web/app/api/open-mic/beats/[fileKey]/route.ts' \
  frontend-web/tests/unit/media/open-mic-beat-storage.test.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "feat(open-mic): serve the official beat from a public, prefix-locked reader

Beats were uploaded through the registration documents route, whose reader
answers 401 unsigned and 403 for anyone but the uploader, so no artist could
hear the beat they were being asked to rap over."
```

---

### Task 2: Admin beat upload route

**Files:**
- Create: `frontend-web/app/api/admin/open-mic/beats/route.ts`
- Modify: `frontend-web/tests/unit/media/open-mic-beat-storage.test.ts` (append the admin-auth mock and a new describe block)

**Interfaces:**
- Consumes: `assertAdminPermission(request, 'programs:manage')` from `@/src/server/admin/auth` (it throws `ApiError(401)` unsigned / `ApiError(403)` unauthorised, which `handleApiError` maps); `hasR2Config`, `uploadR2Object` from `@/src/lib/storage/r2`; `saveLocalUpload` from `@/src/lib/storage/local-uploads`; Task 1's `beatObjectKey`, `beatReaderUrl`.
- Produces: `201 { success: true, beat: { objectKey, previewUrl, downloadUrl, fileName, sizeBytes } }`. Task 6's admin forms read `payload.beat.previewUrl` / `payload.beat.downloadUrl`.

- [ ] **Step 1: Append the failing upload tests**

In `frontend-web/tests/unit/media/open-mic-beat-storage.test.ts`, add this mock **next to the other `vi.mock` calls** (vitest hoists it above the imports):

```ts
const assertAdminPermission = vi.hoisted(() => vi.fn());
const saveLocalUpload = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission }));
```

and change the local-uploads mock to use it:

```ts
vi.mock('@/src/lib/storage/local-uploads', () => ({
  readLocalUpload,
  saveLocalUpload,
  contentTypeForKey: (key: string) => (key.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream'),
}));
```

Add the import and the suite at the end of the file:

```ts
import { ApiError } from '@/src/lib/api/responses';
import { POST } from '@/app/api/admin/open-mic/beats/route';

function beatUploadRequest(opts: { name?: string; type?: string; contestId?: string | null; bytes?: number } = {}) {
  const form = new FormData();
  const body = new Uint8Array(opts.bytes ?? 3);
  form.append('file', new File([body], opts.name ?? 'beat.mp3', { type: opts.type ?? 'audio/mpeg' }));
  if (opts.contestId !== null) form.append('contestId', opts.contestId ?? 'contest-9');
  const query = opts.contestId ? `?contestId=${encodeURIComponent(opts.contestId)}` : '';
  return new Request(`https://web.example.test/api/admin/open-mic/beats${query}`, { method: 'POST', body: form });
}

describe('POST /api/admin/open-mic/beats', () => {
  beforeEach(() => {
    assertAdminPermission.mockReset();
    assertAdminPermission.mockResolvedValue({ role: 'admin', actorId: 'user-1' });
    saveLocalUpload.mockReset();
    saveLocalUpload.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('stores the bytes under openmic-beats/<contestId>/ and returns relative reader paths', async () => {
    const res = await POST(beatUploadRequest());
    expect(res.status).toBe(201);
    const { beat } = await res.json();
    expect(beat.objectKey).toMatch(/^openmic-beats\/contest-9\/[0-9a-f-]+\.mp3$/);
    expect(beat.previewUrl).toBe(`/api/open-mic/beats/${encodeBeatFileKey(beat.objectKey)}`);
    expect(beat.downloadUrl).toBe(`${beat.previewUrl}?download=1`);
    expect(saveLocalUpload.mock.calls[0][0]).toBe(beat.objectKey);
    expect(saveLocalUpload.mock.calls[0][1]).toBeInstanceOf(Buffer);
  });

  it('namespaces under "unassigned" when no contest id is sent, because the builder has no id yet', async () => {
    const res = await POST(beatUploadRequest({ contestId: null }));
    expect((await res.json()).beat.objectKey).toMatch(/^openmic-beats\/unassigned\//);
  });

  it('refuses a contestId that is not a safe path token', async () => {
    const res = await POST(beatUploadRequest({ contestId: '../../registration' }));
    expect(res.status).toBe(400);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });

  it('accepts both mp3 spellings a browser reports', async () => {
    expect((await POST(beatUploadRequest({ type: 'audio/mpeg' }))).status).toBe(201);
    expect((await POST(beatUploadRequest({ type: 'audio/mp3' }))).status).toBe(201);
  });

  it('rejects a non-mp3 name, a mismatched declared type, and anything over 50MB', async () => {
    expect((await POST(beatUploadRequest({ name: 'beat.wav' }))).status).toBe(400);
    expect((await POST(beatUploadRequest({ type: 'text/html' }))).status).toBe(400);
    expect((await POST(beatUploadRequest({ bytes: 51 * 1024 * 1024 }))).status).toBe(400);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });

  it('gates BEFORE reading the body: a forbidden caller stores nothing', async () => {
    assertAdminPermission.mockRejectedValue(new ApiError('Forbidden', 403));
    const res = await POST(beatUploadRequest());
    expect(res.status).toBe(403);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/media/open-mic-beat-storage.test.ts`
Expected: the new block FAILS to load `@/app/api/admin/open-mic/beats/route`; Task 1's tests still pass.

- [ ] **Step 3: Write the upload route**

Create `frontend-web/app/api/admin/open-mic/beats/route.ts`, following `app/api/admin/contests/banner/route.ts`:

```ts
import path from 'path';
import { randomUUID } from 'crypto';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { hasR2Config, uploadR2Object } from '@/src/lib/storage/r2';
import { saveLocalUpload } from '@/src/lib/storage/local-uploads';
import { beatObjectKey, beatReaderUrl } from '@/src/features/openmic/beat-storage';

/**
 * Upload this edition's official beat.
 *
 * Same shape as the contest banner upload: admin-gated on 'programs:manage'
 * (only someone who may edit the contest should attach its beat), server-side
 * credentials, R2 when configured and the local disk otherwise. The difference
 * is what it returns — root-relative reader paths for the caller to store in
 * `competition_beats.preview_url` / `download_url`, replacing the
 * /api/registration/uploads/ values that only the uploader could open.
 *
 * 50MB matches the artist's own submission cap (app/api/open-mic/uploads/presign),
 * so a beat is never smaller than the songs recorded over it.
 */
const MAX_BEAT_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['', 'audio/mp3', 'audio/mpeg']);
const SAFE_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

export async function POST(request: Request) {
  try {
    // Before touching the body: an unauthorised caller learns nothing about
    // which payloads are valid.
    await assertAdminPermission(request, 'programs:manage');

    const formData = await request.formData().catch(() => null);
    if (!formData) return errorResponse('Expected multipart/form-data', 415);

    const contestIdFromQuery = new URL(request.url).searchParams.get('contestId');
    const rawContestId = String(contestIdFromQuery || formData.get('contestId') || '').trim();
    // The builder uploads the beat before the contest row exists, so an id is
    // optional — but it becomes part of the object key, so it must be a token.
    const contestId = rawContestId || 'unassigned';
    // `..` is refused on top of the token class because the public reader
    // (app/api/open-mic/beats/[fileKey]) checks `!key.includes('..')`: a key
    // carrying it would be stored happily and 404 forever, which is the one
    // pairing this route must never break. SAFE_TOKEN's class contains `.`
    // and `.`, so the bare pattern accepts the literal `..` unaided.
    if (rawContestId && (!SAFE_TOKEN.test(rawContestId) || rawContestId.includes('..'))) {
      return errorResponse('contestId is not a valid identifier', 400);
    }

    const file = formData.get('file');
    if (!(file instanceof File)) return errorResponse('file is required', 400);
    if (path.extname(file.name).toLowerCase() !== '.mp3') {
      return errorResponse('Beat must be an MP3 file', 400);
    }
    if (!ALLOWED_TYPES.has(String(file.type || '').toLowerCase())) {
      return errorResponse('Beat must be an MP3 audio file', 400);
    }
    if (file.size > MAX_BEAT_BYTES) {
      return errorResponse('Beat must be 50MB or less', 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const objectKey = beatObjectKey(contestId, randomUUID());
    if (hasR2Config()) {
      await uploadR2Object({ key: objectKey, body: buffer, contentType: 'audio/mpeg' });
    } else {
      await saveLocalUpload(objectKey, buffer);
    }

    return successResponse(
      {
        success: true,
        beat: {
          objectKey,
          previewUrl: beatReaderUrl(objectKey),
          downloadUrl: beatReaderUrl(objectKey, { download: true }),
          fileName: file.name,
          sizeBytes: file.size,
        },
      },
      201,
    );
  } catch (error) {
    console.error('[admin/open-mic/beats] upload failed:', error);
    return handleApiError(error, 'Failed to upload beat');
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/media/open-mic-beat-storage.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx tsc --noEmit` — Expected: exit 0.

```bash
git -C /Users/paymax/Documents/spotlight/main add frontend-web/app/api/admin/open-mic/beats/route.ts \
  frontend-web/tests/unit/media/open-mic-beat-storage.test.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "feat(open-mic): admin mp3 upload that returns public beat reader paths"
```

---

### Task 3: Stop the edition page offering a beat nobody can hear

`app/open-mic/[slug]/page.tsx:95-99` renders `<audio src={contest.beat.previewUrl}>` straight from the row, so an edition carrying a legacy owner-only URL shows a player that fails for every visitor.

**Files:**
- Modify: `frontend-web/app/open-mic/[slug]/page.tsx` (beat block, lines 84-101)
- Test: `frontend-web/tests/unit/media/open-mic-beat-storage.test.ts` (the `publicBeatUrl` cases from Task 1 are the unit proof)

**Interfaces:**
- Consumes: Task 1's `publicBeatUrl`.
- Produces: nothing new; the availability rule is now applied at a public surface, which Task 5's data builder and Task 9's steps component reuse.

- [ ] **Step 1: Apply the rule in the beat block**

In `frontend-web/app/open-mic/[slug]/page.tsx`, add the import next to the other `@/src/features/openmic` imports:

```ts
import { publicBeatUrl } from '@/src/features/openmic/beat-storage';
```

Replace the `<audio>` conditional (currently lines 95-99):

```tsx
                  {(() => {
                    const beatSrc = publicBeatUrl(contest.beat.previewUrl);
                    return beatSrc ? (
                      <audio controls style={{ width: '100%', marginTop: 8 }}>
                        <source src={beatSrc} />
                      </audio>
                    ) : (
                      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 0 }}>
                        The playable beat for this edition is being prepared — download and usage stay available
                        once it is published.
                      </p>
                    );
                  })()}
```

If the arrow-IIFE reads worse than the surrounding JSX, hoist it instead: compute `const beatSrc = contest.beat ? publicBeatUrl(contest.beat.previewUrl) : null;` above the `return` of the beat section and branch on `beatSrc`. Either way the rule stays in `beat-storage.ts` — no surface re-derives it.

- [ ] **Step 2: Verify the storage tests still pass and the tree typechecks**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/media/open-mic-beat-storage.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 3: Commit**

```bash
git -C /Users/paymax/Documents/spotlight/main add 'frontend-web/app/open-mic/[slug]/page.tsx'
git -C /Users/paymax/Documents/spotlight/main commit -m "fix(open-mic): hide the beat player when the stored beat URL is not publicly readable"
```

---

### Task 3b: Await `params` on the eight Open Mic edition pages (blocks every later verification)

**Why this task exists (root cause, already proven — do not re-investigate it):**
Next 16 passes page `params` as a Promise, and seven pages under `app/open-mic/`
read `params.slug` synchronously. Next says so in the dev log verbatim:

```
Error: Route "/open-mic/[slug]/entry" used `params.slug`. `params` is a Promise and must be
unwrapped with `await` or `React.use()` before accessing its properties.
    at OpenMicEntryIndexPage (app/open-mic/[slug]/entry/page.tsx:4:32)
```

Every one of these routes therefore resolves the slug as `undefined`, calls
`getContestBySlug(undefined)`, and renders the not-found boundary (observed: HTTP 200 whose
body contains "This page could not be found", and 61 literal `undefined` strings in the
`/entry` HTML). Their local prop types (`{ params: { slug: string } }`) are what keep
`npx tsc --noEmit` green on a lie, so no type gate catches it.

The spec's steps #02–#05 link straight into these pages — #02 is the edition page, #03 is
`/open-mic/[slug]/enter`, #04 is `/open-mic/[slug]/entry/<artist>`, #05 is
`/open-mic/[slug]/entries` — so nothing in this plan can be verified in a browser until they
render. This is a pre-existing defect, not one Task 3 introduced; Task 3's beat gate is
already correct and shipped.

**Files:** (all Modify; each is the same one-to-three-line mechanical change)
- `frontend-web/app/open-mic/[slug]/page.tsx:9-10`
- `frontend-web/app/open-mic/[slug]/apply/page.tsx:10-11`
- `frontend-web/app/open-mic/[slug]/enter/page.tsx:9-10`
- `frontend-web/app/open-mic/[slug]/entries/page.tsx:8-9`
- `frontend-web/app/open-mic/[slug]/finale/page.tsx:7-8`
- `frontend-web/app/open-mic/[slug]/entry/page.tsx:3-4`
- `frontend-web/app/open-mic/[slug]/entry/[artistSlug]/page.tsx:9-18`
- `frontend-web/app/dashboard/open-mic/[slug]/page.tsx:8-9` (added by the controller after the
  first commit — Step 4b)
- Test: `frontend-web/tests/unit/openmic/open-mic-params.spec.ts`

**Interfaces:**
- Consumes: nothing new. `app/vote/[contestSlug]/[contestantSlug]/layout.tsx:54-56` is the
  working in-repo reference for the pattern (`params: Promise<…>` then `const { … } = await params`).
- Produces: `getContestBySlug(slug)` called with a real string on all seven routes. No export
  changes; Tasks 5, 9 and 10 consume these pages only as URLs.

- [ ] **Step 1: Write the failing guard test**

Create `frontend-web/tests/unit/openmic/open-mic-params.spec.ts`. It reads the seven sources from
disk — the same hermetic idiom as `tests/unit/voting/contract-presence.spec.ts` — because the
property under test is a runtime contract no node-environment suite can exercise:

```ts
// Next 16 hands pages a Promise for params. Reading `params.slug` without awaiting yields
// undefined, getContestBySlug(undefined) yields null, and the page renders its not-found
// boundary at HTTP 200 — every Open Mic route did exactly that. The local prop type
// `{ params: { slug: string } }` compiles fine against the lie, so tsc cannot catch it and
// this guard is what does.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const PAGES = [
  'app/open-mic/[slug]/page.tsx',
  'app/open-mic/[slug]/apply/page.tsx',
  'app/open-mic/[slug]/enter/page.tsx',
  'app/open-mic/[slug]/entries/page.tsx',
  'app/open-mic/[slug]/finale/page.tsx',
  'app/open-mic/[slug]/entry/page.tsx',
  'app/open-mic/[slug]/entry/[artistSlug]/page.tsx',
  'app/dashboard/open-mic/[slug]/page.tsx',
];

const sources = new Map(PAGES.map((rel) => [rel, readFileSync(path.join(ROOT, rel), 'utf8')]));

describe('Open Mic pages unwrap params before use', () => {
  it('declares params as a Promise', () => {
    for (const [rel, src] of sources) {
      expect(src, `${rel} must type params as Promise`).toMatch(/params:\s*Promise<\{[^}]*slug:\s*string/);
    }
  });

  it('awaits params on every path that reads a segment', () => {
    for (const [rel, src] of sources) {
      expect(src, `${rel} must await params`).toMatch(/await params/);
      expect(src, `${rel} must not read params sync`).not.toMatch(/params\.(slug|artistSlug)/);
    }
  });

  it('passes the destructured segment, not params, to the read', () => {
    expect(sources.get('app/open-mic/[slug]/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/apply/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/enter/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/entries/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/finale/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/entry/[artistSlug]/page.tsx')).toContain('getContestBySlug(slug)');
    // Two holes the Task 3b review found, both invisible to the other two tests:
    // a wrong-variable read in the dashboard file, and a slug/artistSlug swap in
    // the two-segment page — `string` compared to `string` still type-checks.
    expect(sources.get('app/dashboard/open-mic/[slug]/page.tsx')).toContain('getContestBySlug(slug)');
    expect(sources.get('app/open-mic/[slug]/entry/[artistSlug]/page.tsx')).toContain('=== artistSlug');
    expect(sources.get('app/open-mic/[slug]/entry/page.tsx')).toContain('redirect(`/open-mic/${slug}/entries`)');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic/open-mic-params.spec.ts`
Expected: FAIL — every file matches `params\.(slug|artistSlug)` and none has `await params`.

- [ ] **Step 3: Fix the five single-segment pages**

Each file below changes the same two lines. In `app/open-mic/[slug]/page.tsx`:

```tsx
export default async function OpenMicContestDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const contest = await getContestBySlug(slug);
```

In `app/open-mic/[slug]/apply/page.tsx` (function name `OpenMicApplyPage`, and its own local
`contest` uses follow at whatever lines they appear — replace every `params.slug` with `slug`):

```tsx
export default async function OpenMicApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let contest = await getContestBySlug(slug);
```

In `app/open-mic/[slug]/enter/page.tsx` (function name `OpenMicContestEntryPage`):

```tsx
export default async function OpenMicContestEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const contest = await getContestBySlug(slug);
```

In `app/open-mic/[slug]/entries/page.tsx` (function name `OpenMicEntriesPage`):

```tsx
export default async function OpenMicEntriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const contest = await getContestBySlug(slug);
```

In `app/open-mic/[slug]/finale/page.tsx` (function name `OpenMicFinalePage`):

```tsx
export default async function OpenMicFinalePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const contest = await getContestBySlug(slug);
```

- [ ] **Step 4: Fix the redirect page and the two-segment page**

`app/open-mic/[slug]/entry/page.tsx` is currently a synchronous component — it must become async,
or use `React.use`. Take the async form, matching its siblings:

```tsx
import { redirect } from 'next/navigation';

export default async function OpenMicEntryIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/open-mic/${slug}/entries`);
}
```

`app/open-mic/[slug]/entry/[artistSlug]/page.tsx` destructures across a multi-line signature and
uses both segments (`params.slug` at line 14, `params.artistSlug` at line 18):

```tsx
export default async function OpenMicArtistVotingPage({
  params,
}: {
  params: Promise<{ slug: string; artistSlug: string }>;
}) {
  const { slug, artistSlug } = await params;
  const contest = await getContestBySlug(slug);
  if (!contest) notFound();

  const entries = await getLeaderboard(contest.id);
  const entry = entries.find((e) => slugifyArtist(e.stageName) === artistSlug);
```

- [ ] **Step 4b: The eighth page — `app/dashboard/open-mic/[slug]/page.tsx`**

Found by the Task 3b implementer and confirmed by the controller: the artist-facing Open Mic
dashboard carries the identical defect at `:8-9`

```ts
export default async function ArtistOpenMicDashboardPage({ params }: { params: { slug: string } }) {
  const contest = await getContestBySlug(params.slug);
```

and was, at the time of writing, the last synchronous `params.slug` read anywhere under an
Open Mic path. It is not linked from steps #02–#05, so it does not gate this plan's verification —
but a guard whose value is "no Open Mic page reads `params` synchronously" must not be written to
notice seven of eight. Same mechanical fix:

```ts
export default async function ArtistOpenMicDashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const contest = await getContestBySlug(slug);
```

Two sibling routes reported in the same breath — `app/talent-vault/[slug]/page.tsx:6-7` and
`app/services/[slug]/page.tsx:10-11,27-28` — have the same defect and are deliberately **out of
scope here**: unrelated feature areas, no bearing on this spec, and pulling them in would make a
targeted fix into a sweep. They belong to the final whole-branch review as a reported finding.

- [ ] **Step 5: Fix the fallback copy that promises a control this page has none of**

Task 3's review found a plan defect in the sentence shipped at
`app/open-mic/[slug]/page.tsx:107-110`: it says *"download and usage stay available once it is
published"*, but the edition page renders no download button and no usage file — the download CTA
is Task 9's job inside the steps block. A shipped page must not advertise a control that is not on
it. Replace the body of that `<p>` (lines 108-109 only; the element, its inline style and the
`:114` "Beat not uploaded yet" branch stay as they are):

```tsx
                    <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 0 }}>
                      Playback will be available once this edition&#39;s beat is published.
                    </p>
```

Ride along reason: this file is already open for Steps 1–4, so it is one logical change (make the
edition route honest) rather than two commits. Task 9 owns the real download CTA and Task 10
re-reads this sentence in the browser.

- [ ] **Step 6: Run the guard, the type gate, and prove it at runtime**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic && npx tsc --noEmit && npx eslint "app/open-mic/[slug]"`
Expected: guard PASSes (3 cases — the spec has three `it` blocks), tsc exit 0, eslint exit 0.

Then prove the runtime actually renders, because a green guard on a rewritten source is still
just a string match. With the dev server on :3000 (start `npm run dev` from `frontend-web` if
nothing is listening), re-request the route that produced the log error and check the server's
own log for the sync-dynamic-apis message:

```bash
curl -s -o /dev/null --max-time 60 "http://localhost:3000/open-mic/probe-slug-xyz/entry"
grep -c "must be unwrapped" /tmp/spotlight-fe-dev.log   # or whichever log file your server writes
```

Expected: the count does NOT increase after the request. Before the fix it incremented on every
hit — that is the before/after evidence this task needs, and the number must be recorded in the
report. Do not restart the server to make the grep look clean; compare against the pre-fix log
growth.

- [ ] **Step 7: Commit**

```bash
git -C /Users/paymax/Documents/spotlight/main add "frontend-web/app/open-mic/[slug]/page.tsx" \
  "frontend-web/app/open-mic/[slug]/apply/page.tsx" \
  "frontend-web/app/open-mic/[slug]/enter/page.tsx" \
  "frontend-web/app/open-mic/[slug]/entries/page.tsx" \
  "frontend-web/app/open-mic/[slug]/finale/page.tsx" \
  "frontend-web/app/open-mic/[slug]/entry/page.tsx" \
  "frontend-web/app/open-mic/[slug]/entry/[artistSlug]/page.tsx" \
  "frontend-web/app/dashboard/open-mic/[slug]/page.tsx" \
  frontend-web/tests/unit/openmic/open-mic-params.spec.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "fix(open-mic): await params so the edition routes resolve their slug"
```
Stage and commit in one shell invocation with the literal pathspecs on both — see the Global
Constraints on commits. The bracketed directory names need quoting; `\[slug]` inside double
quotes is a literal pathspec.

---

### Task 4: One definition of the current edition

**Files:**
- Create: `frontend-web/src/features/openmic/active-edition.ts`
- Modify: `frontend-web/app/apply/open-mic-competition/page.tsx`
- Modify: `frontend-web/app/open-mic/[slug]/apply/page.tsx:13-23` (the second inline copy of the
  same judgement, found by the controller after Task 3b started — see Step 5b)
- Test: `frontend-web/tests/unit/openmic/active-edition.test.ts`

**Interfaces:**
- Consumes: `listContests()` from `@/src/server/openmic/persistence` — already restricted to `contest_type = OPEN_MIC_CONTEST_TYPE` (`'one_beat_one_verse'`, `src/features/openmic/constants.ts`), already drops `visibility === 'hidden'`, already returns `[]` when Supabase reads are unconfigured (`persistence.ts:346-364`). This module must not re-filter any of that.
- Produces: `CURRENT_OPEN_MIC_STATUSES`, `getActiveOpenMicEdition(): Promise<OpenMicContest | null>`. Task 5 adds the builder to the same file; Task 10's page calls `loadOpenMicEditionSteps()`.

- [ ] **Step 1: Write the failing selector tests**

Create `frontend-web/tests/unit/openmic/active-edition.test.ts`:

```ts
// "The current edition" must mean one thing everywhere. listContests() already
// filters by contest_type and visibility, so the only judgement left is which
// statuses still count as live — and the old apply page answered it with
// `|| contests[0]`, which sent people to a draft or ended edition whenever
// nothing was live.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listContests = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/openmic/persistence', () => ({ listContests }));

import { getActiveOpenMicEdition } from '@/src/features/openmic/active-edition';
import type { OpenMicContest } from '@/src/features/openmic/types';

const START = '2026-11-01T00:00:00.000Z';
const END = '2026-11-30T23:59:59.000Z';

function contest(overrides: Partial<OpenMicContest> = {}): OpenMicContest {
  return {
    id: 'contest-1',
    title: 'November Open Mic',
    slug: 'open-mic-dev',
    status: 'voting_live',
    visibility: 'public',
    month: 11,
    year: 2026,
    season: 'Season 2',
    description: '',
    registrationFeeNgn: 0,
    entryFeeRequired: false,
    selectionModel: 'hybrid',
    finalistsTarget: 10,
    judgeWeight: 30,
    publicVoteWeight: 70,
    registrationStartAt: START,
    registrationEndAt: END,
    submissionStartAt: START,
    submissionEndAt: END,
    votingConfig: { enabled: true, freeVoting: true, freeVotesPerDay: 3, paidVoting: true, votePrice: 100, leaderboardVisible: true, voteCountPublic: true, votingStartAt: START, votingEndAt: END },
    recurrence: { enabled: false, repeatMonths: 1, autoCreateNext: false, autoCopySettings: true, autoPublishFuture: false, requireNewBeatEveryMonth: true },
    finale: { venueName: 'Spotlight Lounge', venueType: 'lounge', address: '', city: 'Lagos', state: 'Lagos', playbackMode: 'top_10' },
    finalePlaylist: [],
    finalePlaylistLocked: false,
    prizes: [],
    createdAt: START,
    updatedAt: START,
    ...overrides,
  } as OpenMicContest;
}

beforeEach(() => {
  listContests.mockReset();
});

// The selector's contract is that it classifies the whole status vocabulary,
// and the union in `types.ts` is the only place that vocabulary is written
// down — nothing in this repo enumerates it at runtime. So completeness can
// only be checked by the compiler: drop any status from the two lists below
// and `tsc` fails on the assertion after them, which is the mistake that made
// the finale statuses look ended. Exported so it reads as deliberate rather
// than an unused local.
const LIVE_STATUSES = [
  'published', 'registration_open', 'beat_available', 'submission_open',
  'submission_closed', 'under_review', 'voting_live', 'voting_closed',
  'finalists_selected', 'grand_finale_scheduled', 'grand_finale_live',
] as const satisfies readonly OpenMicContest['status'][];

const ENDED_STATUSES = [
  'draft', 'scheduled', 'winner_announced', 'completed', 'archived', 'suspended', 'cancelled',
] as const satisfies readonly OpenMicContest['status'][];

type Unclassified = Exclude<OpenMicContest['status'], typeof LIVE_STATUSES[number] | typeof ENDED_STATUSES[number]>;

export const EVERY_STATUS_IS_CLASSIFIED: [Unclassified] extends [never] ? true : ['status classified nowhere', Unclassified] = true;

describe('getActiveOpenMicEdition', () => {
  it('returns the newest row whose status is still live', async () => {
    listContests.mockResolvedValue([contest({ slug: 'newest', status: 'submission_open' }), contest({ slug: 'oldest', status: 'voting_live' })]);
    const picked = await getActiveOpenMicEdition();
    expect(picked?.slug).toBe('newest');
  });

  it('counts every status in which a step of the route is still live', async () => {
    for (const status of LIVE_STATUSES) {
      listContests.mockResolvedValue([contest({ status })]);
      expect(await getActiveOpenMicEdition()).not.toBeNull();
    }
  });

  it('ignores editions that never started, finished, or were called off', async () => {
    for (const status of ENDED_STATUSES) {
      listContests.mockResolvedValue([contest({ status })]);
      expect(await getActiveOpenMicEdition()).toBeNull();
    }
  });

  it('never falls back to an unreadable edition when nothing qualifies', async () => {
    listContests.mockResolvedValue([contest({ status: 'draft', slug: 'draft-one' })]);
    expect(await getActiveOpenMicEdition()).toBeNull();
  });

  it('does not re-filter: it asks listContests for its default, public view', async () => {
    listContests.mockResolvedValue([]);
    await getActiveOpenMicEdition();
    expect(listContests).toHaveBeenCalledWith();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic/active-edition.test.ts`
Expected: FAIL — `Failed to load …/src/features/openmic/active-edition`.

- [ ] **Step 3: Write the selector**

Create `frontend-web/src/features/openmic/active-edition.ts`:

```ts
import { listContests } from '@/src/server/openmic/persistence';
import type { OpenMicContest } from '@/src/features/openmic/types';

/**
 * An edition is current from the moment it is published until its result is
 * announced. The finale (`grand_finale_scheduled`, `grand_finale_live`) is
 * inside that window — it is the step the edition is on, and an artist who
 * opens `/apply` during it still has a live edition to apply to. Everything
 * outside either never started (`draft`, `scheduled`), finished
 * (`winner_announced`, `completed`, `archived`) or was called off (`suspended`,
 * `cancelled`) — none of which has a live step to show.
 *
 * The narrow list this replaces (`registration_open`, `published`,
 * `submission_open`, `voting_live`) dropped an edition the moment its beat was
 * published or its window closed, so the programme page went blank while the
 * admin console still called the edition live.
 */
export const CURRENT_OPEN_MIC_STATUSES = [
  'published',
  'registration_open',
  'beat_available',
  'submission_open',
  'submission_closed',
  'under_review',
  'voting_live',
  'voting_closed',
  'finalists_selected',
  'grand_finale_scheduled',
  'grand_finale_live',
] as const satisfies readonly OpenMicContest['status'][];

/**
 * The one current edition, or null. listContests() already restricts rows to
 * contest_type = 'one_beat_one_verse', drops hidden ones, returns [] when
 * Supabase reads are unconfigured and orders `created_at desc`, so "first live
 * row" is "the newest live edition" and nothing here re-filters — and nothing
 * here falls back to "the newest row whatever it is", which is how the apply
 * page used to redirect artists into an ended edition.
 */
export async function getActiveOpenMicEdition(): Promise<OpenMicContest | null> {
  const contests = await listContests();
  const live = new Set<string>(CURRENT_OPEN_MIC_STATUSES);
  return contests.find((row) => live.has(row.status)) ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic/active-edition.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Adopt it on the apply page**

Replace `frontend-web/app/apply/open-mic-competition/page.tsx` in full:

```ts
import { redirect } from 'next/navigation';
import { getActiveOpenMicEdition } from '@/src/features/openmic/active-edition';

export const dynamic = 'force-dynamic';

export default async function LegacyOpenMicApplyPage() {
  const edition = await getActiveOpenMicEdition();
  // No `|| contests[0]`: pointing someone straight at a draft or ended edition
  // is worse than the editions list on /open-mic, which at least names the
  // month and shows each edition's own status badge.
  redirect(edition ? `/open-mic/${edition.slug}/apply` : '/open-mic');
}
```

- [ ] **Step 5b: Adopt it on the slug-scoped apply page too**

`app/open-mic/[slug]/apply/page.tsx` holds a *second* copy of the same decision: when the requested
slug does not resolve, it picks the current edition to redirect to using the very same narrow list
plus the same `|| contests[0]` escape hatch (lines 14-18). A task called "one definition of the
current edition" that leaves that literal behind re-creates the defect on the page step #03 links
to. Replace the body of the `if (!contest)` block:

```ts
  if (!contest) {
    const fallback = await getActiveOpenMicEdition();
    if (fallback) {
      redirect(`/open-mic/${fallback.slug}/apply`);
    }
    notFound();
  }
```

Add `getActiveOpenMicEdition` to the `@/src/features/openmic/active-edition` import and **drop
`listContests` from the `@/src/server/openmic/persistence` import** — line 14 is its only use in
the file. (Checked: this repo's eslint config does not flag unused imports, so nothing fails if you
leave it — drop it anyway.) Do not otherwise reformat this page; Task 3b owns its `params`
signature.

- [ ] **Step 6: Verify, then commit**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0, no lint errors.

```bash
git -C /Users/paymax/Documents/spotlight/main add frontend-web/src/features/openmic/active-edition.ts \
  frontend-web/app/apply/open-mic-competition/page.tsx \
  "frontend-web/app/open-mic/[slug]/apply/page.tsx" \
  frontend-web/tests/unit/openmic/active-edition.test.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "feat(open-mic): give the current edition one definition

The apply page's `|| contests[0]` fallback redirected artists to a draft or
ended edition whenever nothing was live; the status list it did check also
dropped an edition as soon as its beat went up or its window closed."
```

---

### Task 5: `OpenMicEditionStepsData` — the server's single read

**Files:**
- Modify: `frontend-web/src/features/openmic/active-edition.ts`
- Test: `frontend-web/tests/unit/openmic/edition-steps-data.spec.ts`

**Interfaces:**
- Consumes: Task 4's `getActiveOpenMicEdition`, `getLeaderboard` + `mapSubmissionRow` shapes (`voteCount ← public_vote_count`, `songTitle ← entry_title`, `stageName ← lyrical_concept_summary.stageName`), Task 1's `publicBeatUrl`, `slugifyArtist` from `@/src/features/openmic/workflow`, `contest.beat.{beatTitle,producerCredit,producerName,usageRules,previewUrl,downloadUrl,allowDownload,requiresPaidEntryForDownload}` (`persistence.ts:215-232`, where `allowDownload = is_active === true` and `previewOnly` is inert on the DB path).
- Produces: `OpenMicEditionStepsData` (its `board` is `null` when the read failed and `{rows: [], entryCount: 0, totalVotes: 0}` when the contest really has no entries) and `buildOpenMicEditionStepsData(contest, board | null)`, `loadOpenMicEditionSteps()`. Task 9's component and Task 10's page consume the type; the field names below are the contract.

- [ ] **Step 1: Write the failing builder tests**

Create `frontend-web/tests/unit/openmic/edition-steps-data.spec.ts`:

```ts
// The steps block gets one serialisable object from the server so no client
// branch re-derives availability, re-filters the board, or has to know that
// `voteCountPublic` can be turned off by an admin.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listContests = vi.hoisted(() => vi.fn());
const getLeaderboard = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/openmic/persistence', () => ({ listContests, getLeaderboard }));

import {
  buildOpenMicEditionStepsData,
  loadOpenMicEditionSteps,
  type OpenMicEditionStepsData,
} from '@/src/features/openmic/active-edition';
import type { OpenMicContest, OpenMicSubmission } from '@/src/features/openmic/types';

const START = '2026-11-01T00:00:00.000Z';
const END = '2026-11-30T23:59:59.000Z';

function contest(overrides: Partial<OpenMicContest> = {}): OpenMicContest {
  return {
    id: 'contest-1', slug: 'open-mic-dev', title: 'November Open Mic', status: 'voting_live',
    month: 11, year: 2026, season: 'Season 2', description: '', visibility: 'public',
    registrationFeeNgn: 1500, entryFeeRequired: true, selectionModel: 'hybrid',
    finalistsTarget: 10, judgeWeight: 30, publicVoteWeight: 70,
    registrationStartAt: START, registrationEndAt: END, submissionStartAt: START, submissionEndAt: END,
    votingConfig: { enabled: true, freeVoting: true, freeVotesPerDay: 3, paidVoting: true, votePrice: 100, leaderboardVisible: true, voteCountPublic: true, votingStartAt: START, votingEndAt: END },
    recurrence: { enabled: false, repeatMonths: 1, autoCreateNext: false, autoCopySettings: true, autoPublishFuture: false, requireNewBeatEveryMonth: true },
    finale: { venueName: 'Spotlight Lounge', venueType: 'lounge', address: '', city: 'Lagos', state: 'Lagos', playbackMode: 'top_10' },
    finalePlaylist: [], finalePlaylistLocked: false, prizes: [], createdAt: START, updatedAt: START,
    beat: {
      id: 'beat-1', contestId: 'contest-1', beatTitle: 'Street Light', producerName: 'DJ Wole',
      producerCredit: 'DJ Wole', previewUrl: '/api/open-mic/beats/abc', downloadUrl: '/api/open-mic/beats/abc?download=1',
      genre: 'Hip Hop', usageRules: 'Original bars only.', allowDownload: true, previewOnly: false,
      requiresPaidEntryForDownload: false, explicitLyricsAllowed: true, cleanVersionRequired: false,
    },
    ...overrides,
  } as OpenMicContest;
}

function entry(n: number, overrides: Partial<OpenMicSubmission> = {}): OpenMicSubmission {
  return {
    id: `entry-${n}`, contestId: 'contest-1', contestSlug: 'open-mic-dev',
    stageName: `Artist ${n}`, songTitle: `Track ${n}`, songUrl: `/api/open-mic/songs/entry-${n}`,
    genre: 'Hip Hop', status: 'published_for_voting', voteCount: n * 10, leaderboardScore: n * 10,
    explicitVersion: false, officialBeatConfirmed: true, ownershipConfirmed: true,
    isFinalist: false, isWinner: false, createdAt: START, updatedAt: START,
    ...overrides,
  } as OpenMicSubmission;
}

beforeEach(() => {
  listContests.mockReset();
  getLeaderboard.mockReset();
});

describe('buildOpenMicEditionStepsData', () => {
  it('normalises every window date to a string or null, never undefined', () => {
    const bare = buildOpenMicEditionStepsData(contest({ registrationStartAt: undefined, submissionEndAt: undefined }), []);
    expect(bare.registrationStartAt).toBeNull();
    expect(bare.submissionEndAt).toBeNull();
    expect(bare.votingStartAt).toBe(START);
    // toStrictEqual, not toEqual: a stray `undefined`-valued key would survive
    // toEqual and be silently dropped on the way to the client.
    expect(JSON.parse(JSON.stringify(bare))).toStrictEqual(bare);
  });

  it('exposes the beat that is publicly playable', () => {
    const data = buildOpenMicEditionStepsData(contest(), []);
    expect(data.beat).toMatchObject({
      title: 'Street Light', producerCredit: 'DJ Wole', usageRules: 'Original bars only.',
      previewUrl: '/api/open-mic/beats/abc', downloadUrl: '/api/open-mic/beats/abc?download=1',
      downloadable: true, requiresPaidEntry: false,
    });
  });

  it('nulls a legacy owner-only beat URL so no surface offers a player that 403s', () => {
    const data = buildOpenMicEditionStepsData(
      contest({ beat: { ...contest().beat!, previewUrl: '/api/registration/uploads/x.mp3', downloadUrl: '/api/registration/uploads/x.mp3' } }),
      [],
    );
    expect(data.beat?.previewUrl).toBeNull();
    expect(data.beat?.downloadUrl).toBeNull();
    expect(data.beat?.downloadable).toBe(false);
  });

  it('keeps the player but drops the download button when the admin switched download off', () => {
    const data = buildOpenMicEditionStepsData(contest({ beat: { ...contest().beat!, allowDownload: false } }), []);
    expect(data.beat?.previewUrl).toBe('/api/open-mic/beats/abc');
    expect(data.beat?.downloadable).toBe(false);
  });

  it('never promises a paid-entry lock on a download it cannot serve', () => {
    const locked = buildOpenMicEditionStepsData(
      contest({ beat: { ...contest().beat!, requiresPaidEntryForDownload: true } }),
      [],
    );
    expect(locked.beat?.requiresPaidEntry).toBe(true);

    const unserveable = buildOpenMicEditionStepsData(
      contest({ beat: { ...contest().beat!, downloadUrl: '/api/registration/uploads/x.mp3', requiresPaidEntryForDownload: true } }),
      [],
    );
    expect(unserveable.beat?.downloadUrl).toBeNull();
    expect(unserveable.beat?.requiresPaidEntry).toBe(false);
  });

  it('drops the paid-entry lock when the admin deactivated the beat too', () => {
    const data = buildOpenMicEditionStepsData(
      contest({ beat: { ...contest().beat!, allowDownload: false, requiresPaidEntryForDownload: true } }),
      [],
    );
    expect(data.beat?.downloadable).toBe(false);
    expect(data.beat?.requiresPaidEntry).toBe(false);
  });

  it('omits the beat object when the edition has none', () => {
    const data = buildOpenMicEditionStepsData(contest({ beat: undefined }), []);
    expect(data.beat).toBeNull();
  });

  it('truncates the board to five, with canonical artist slugs and the store\'s totals', () => {
    const board = Array.from({ length: 8 }, (_, i) => entry(i + 1));
    const data = buildOpenMicEditionStepsData(contest(), board);
    expect(data.board?.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(data.board?.rows[0]).toStrictEqual({ rank: 1, artistSlug: 'artist-1', stageName: 'Artist 1', songTitle: 'Track 1', voteCount: 10 });
    expect(data.board?.entryCount).toBe(8);
    expect(data.board?.totalVotes).toBe(360);
  });

  it('numbers rows by store position, never re-sorting by votes', () => {
    // getLeaderboard orders by leaderboard_score (a judge-weighted composite),
    // which need not track public_vote_count. Re-sorting here would contradict
    // the full leaderboard the "Vote now" button links to.
    const mixed = [entry(1, { voteCount: 5 }), entry(2, { voteCount: 90 }), entry(3, { voteCount: 40 })];
    const rows = buildOpenMicEditionStepsData(contest(), mixed).board?.rows;
    expect(rows?.map((row) => row.voteCount)).toEqual([5, 90, 40]);
    expect(rows?.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('slugifies a name with punctuation exactly as the entry page looks it up', () => {
    const data = buildOpenMicEditionStepsData(contest(), [entry(1, { stageName: 'K1ng$hoota' })]);
    expect(data.board?.rows[0].artistSlug).toBe('k1nghoota');
  });

  it('tells a board that is genuinely empty apart from one it could not read', () => {
    expect(buildOpenMicEditionStepsData(contest(), []).board).toStrictEqual({ rows: [], entryCount: 0, totalVotes: 0 });
    expect(buildOpenMicEditionStepsData(contest(), null).board).toBeNull();
  });

  it('carries the two admin display switches through as booleans', () => {
    const hidden = buildOpenMicEditionStepsData(
      contest({ votingConfig: { ...contest().votingConfig, leaderboardVisible: false, voteCountPublic: false } }),
      [entry(1)],
    );
    expect(hidden.showLeaderboard).toBe(false);
    expect(hidden.showVoteCounts).toBe(false);
  });
});

describe('loadOpenMicEditionSteps', () => {
  it('returns null with no current edition and never queries a board', async () => {
    listContests.mockResolvedValue([contest({ status: 'draft' })]);
    expect(await loadOpenMicEditionSteps()).toBeNull();
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  it('degrades to an unreadable board when the leaderboard read throws', async () => {
    listContests.mockResolvedValue([contest()]);
    getLeaderboard.mockRejectedValue(new Error('db down'));
    const data: OpenMicEditionStepsData | null = await loadOpenMicEditionSteps();
    expect(data?.board).toBeNull();
    expect(data?.slug).toBe('open-mic-dev');
  });

  it('keeps a zeroed board when the read succeeds and returns nothing', async () => {
    listContests.mockResolvedValue([contest()]);
    getLeaderboard.mockResolvedValue([]);
    const data: OpenMicEditionStepsData | null = await loadOpenMicEditionSteps();
    expect(data?.board).toStrictEqual({ rows: [], entryCount: 0, totalVotes: 0 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic/edition-steps-data.spec.ts`
Expected: FAIL — `buildOpenMicEditionStepsData` / `loadOpenMicEditionSteps` / `OpenMicEditionStepsData` are not exported.

- [ ] **Step 3: Write the builder and loader**

Append to `frontend-web/src/features/openmic/active-edition.ts`. Task 4 deliberately left that file
importing only what the selector reads, so all four dependencies this builder needs are added here:

```ts
import { getLeaderboard, listContests } from '@/src/server/openmic/persistence';      // widen: +getLeaderboard
import type { OpenMicContest, OpenMicSubmission } from '@/src/features/openmic/types'; // widen: +OpenMicSubmission
import { slugifyArtist } from '@/src/features/openmic/workflow';                      // new
import { publicBeatUrl } from '@/src/features/openmic/beat-storage';                  // new

/** Everything the steps block renders. Availability, the display switches and
 *  the board's numbers are decided server-side; the only thing the browser
 *  recomputes is which side of a window `Date.now()` falls on, from the ISO
 *  strings below. No Date objects: this crosses the server/client boundary. */
export type OpenMicEditionStepsData = {
  id: string;
  slug: string;
  title: string;
  status: OpenMicContest['status'];
  registrationStartAt: string | null;
  registrationEndAt: string | null;
  submissionStartAt: string | null;
  submissionEndAt: string | null;
  votingStartAt: string | null;
  votingEndAt: string | null;
  registrationFeeNgn: number;
  entryFeeRequired: boolean;
  showLeaderboard: boolean;
  showVoteCounts: boolean;
  beat: {
    title: string;
    producerCredit: string;
    usageRules: string;
    previewUrl: string | null;
    downloadUrl: string | null;
    downloadable: boolean;
    requiresPaidEntry: boolean;
  } | null;
  /** `null` means the board could not be read — which is not the same fact as
   *  "0 entries", and the page must never render a number for it. */
  board: {
    rows: { rank: number; artistSlug: string; stageName: string; songTitle: string; voteCount: number }[];
    entryCount: number;
    totalVotes: number;
  } | null;
};

function at(value: string | undefined): string | null {
  return value ?? null;
}

/** `board` arrives already ordered by the store (leaderboard_score, then
 *  public_vote_count) — this only projects, truncates and totals. Pass `null`
 *  for "the board could not be read"; `[]` means it was read and is empty. */
export function buildOpenMicEditionStepsData(
  contest: OpenMicContest,
  board: OpenMicSubmission[] | null,
): OpenMicEditionStepsData {
  const beat = contest.beat;
  const previewUrl = beat ? publicBeatUrl(beat.previewUrl) : null;
  const downloadUrl = beat ? publicBeatUrl(beat.downloadUrl) : null;
  // A beat is offered for download only when the admin left it active
  // (is_active -> allowDownload) AND the stored path is one the public reader
  // will actually serve.
  const downloadable = beat ? beat.allowDownload === true && downloadUrl !== null : false;

  return {
    id: contest.id,
    slug: contest.slug,
    title: contest.title,
    status: contest.status,
    registrationStartAt: at(contest.registrationStartAt),
    registrationEndAt: at(contest.registrationEndAt),
    submissionStartAt: at(contest.submissionStartAt),
    submissionEndAt: at(contest.submissionEndAt),
    votingStartAt: at(contest.votingConfig?.votingStartAt),
    votingEndAt: at(contest.votingConfig?.votingEndAt),
    registrationFeeNgn: contest.registrationFeeNgn,
    entryFeeRequired: contest.entryFeeRequired,
    showLeaderboard: contest.votingConfig?.leaderboardVisible !== false,
    showVoteCounts: contest.votingConfig?.voteCountPublic !== false,
    beat: beat
      ? {
          title: beat.beatTitle,
          producerCredit: beat.producerCredit || beat.producerName || '',
          usageRules: beat.usageRules || '',
          previewUrl,
          downloadUrl,
          downloadable,
          // One rule, not two: a lock on a download this object has already
          // decided not to offer would tell an artist to pay for nothing.
          requiresPaidEntry: beat.requiresPaidEntryForDownload === true && downloadable,
        }
      : null,
    board: board === null
      ? null
      : {
          rows: board.slice(0, 5).map((row, index) => ({
            rank: index + 1,
            artistSlug: slugifyArtist(row.stageName),
            stageName: row.stageName,
            songTitle: row.songTitle,
            voteCount: row.voteCount,
          })),
          // Totals are of the whole board, not the five rows shown.
          entryCount: board.length,
          totalVotes: board.reduce((sum, row) => sum + row.voteCount, 0),
        },
  };
}

/**
 * One server read for the programme page. A failed leaderboard read does not
 * take the page down and does not invent a number either: getLeaderboard
 * already returns [] when the DB is unconfigured and for a genuinely empty
 * contest, so only a thrown error reaches `null`.
 */
export async function loadOpenMicEditionSteps(): Promise<OpenMicEditionStepsData | null> {
  const contest = await getActiveOpenMicEdition();
  if (!contest) return null;
  let board: OpenMicSubmission[] | null = [];
  try {
    board = await getLeaderboard(contest.id);
  } catch {
    // A read that failed is not a contest with no entries: `null` is the only
    // value that stops the page printing "0 entries".
    board = null;
  }
  return buildOpenMicEditionStepsData(contest, board);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic`
Expected: PASS — 23 tests: Task 3b's `open-mic-params.spec.ts` (3) + Task 4's 5 + this file's 15. (Count the directory, not just this task: `tests/unit/openmic` already holds other tasks' specs.)

- [ ] **Step 5: Typecheck and commit**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx tsc --noEmit` — Expected: exit 0.

```bash
git -C /Users/paymax/Documents/spotlight/main add frontend-web/src/features/openmic/active-edition.ts \
  frontend-web/tests/unit/openmic/edition-steps-data.spec.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "feat(open-mic): build the competition steps data server-side

Availability, the admin's board display switches and the top-five cut are all
decided once here so the programme page renders honest states instead of
re-deriving them in the browser."
```

---

### Task 6: Point the two admin beat forms at the new route

**Files:**
- Modify: `frontend-web/components/openmic/OpenMicAdminContestBuilder.tsx:87-115` (upload), `:83` (required-field copy), `:314-334` (URL fields + warning), `:319`/`:323` (label + `accept`)
- Modify: `frontend-web/components/openmic/OpenMicAdminContestEditor.tsx:58-80` (upload), `:199-213` (URL fields + warning), `:204`/`:208` (label + `accept`)
- Test: `frontend-web/tests/unit/openmic/admin-beat-wiring.spec.ts`

**Interfaces:**
- Consumes: Task 2's `POST /api/admin/open-mic/beats` response `{ success, beat: { previewUrl, downloadUrl } }`; `adminAuthHeaders(false)` from `@/src/lib/auth/client` (Authorization + role header, no Content-Type, so FormData still works); Task 1's `isLegacyBeatUrl`.
- Produces: rows whose `preview_url` / `download_url` are `/api/open-mic/beats/…` paths.

- [ ] **Step 1: Write the failing guard test**

Create `frontend-web/tests/unit/openmic/admin-beat-wiring.spec.ts`. It reads the two component sources from disk — the same hermetic idiom as `tests/unit/voting/contract-presence.spec.ts` — because the behaviour it guards is a wiring fact with no runtime to exercise in a node-environment suite:

```ts
// Both admin surfaces used to upload the beat through POST /api/registration/uploads
// and store the owner-only URL it returned, which is exactly how every artist
// ended up with a beat they could not play. The guard: they target the dedicated
// beat route, store what it returns, and say so when a row predates the fix.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const BUILDER = read('components/openmic/OpenMicAdminContestBuilder.tsx');
const EDITOR = read('components/openmic/OpenMicAdminContestEditor.tsx');

describe('admin beat upload wiring', () => {
  it('sends both forms to the public beat route', () => {
    for (const source of [BUILDER, EDITOR]) {
      expect(source).toContain('/api/admin/open-mic/beats');
      expect(source).not.toContain('/api/registration/uploads');
    }
  });

  it('stores the reader paths the route returns', () => {
    for (const source of [BUILDER, EDITOR]) {
      expect(source).toMatch(/payload\?\.beat\?\.previewUrl|beat\.previewUrl/);
      expect(source).toMatch(/beat\.downloadUrl|payload\?\.beat\?\.downloadUrl/);
    }
  });

  it('warns an admin re-opening a legacy edition instead of leaving it silent', () => {
    expect(BUILDER).toContain('isLegacyBeatUrl');
    expect(EDITOR).toContain('isLegacyBeatUrl');
    expect(EDITOR).toMatch(/re-upload/i);
  });

  it('offers only the format the route actually accepts', () => {
    // Task 2's route answers 400 for any extension that is not .mp3 and any
    // declared type outside {'', audio/mp3, audio/mpeg}. Both pickers still
    // advertise .wav and .m4a, which invites an admin to upload a file the
    // server refuses — and the legacy-URL warning cannot explain that, because
    // the field stays empty, so isLegacyBeatUrl('') is false.
    for (const source of [BUILDER, EDITOR]) {
      expect(source).toMatch(/accept="\.mp3"/);
      expect(source).not.toMatch(/accept="[^"]*\.(wav|m4a)/);
      expect(source).not.toContain('(MP3/WAV)');
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic/admin-beat-wiring.spec.ts`
Expected: FAIL on the first case (both files still contain `/api/registration/uploads`).

- [ ] **Step 3: Rewire the builder**

In `frontend-web/components/openmic/OpenMicAdminContestBuilder.tsx`, replace `uploadBeatFile` (lines 87-115) — the contest does not exist yet, so no `contestId` is sent and the bytes land under `openmic-beats/unassigned/`:

```tsx
  async function uploadBeatFile(file: File) {
    setUploadingBeat(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/admin/open-mic/beats', {
        method: 'POST',
        headers: await adminAuthHeaders(false),
        body,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Beat upload failed.');
      }
      const previewUrl = String(payload?.beat?.previewUrl || '');
      const downloadUrl = String(payload?.beat?.downloadUrl || '');
      if (!downloadUrl) throw new Error('Upload succeeded but no beat URL was returned.');
      setForm((prev) => ({ ...prev, beatDownloadUrl: downloadUrl, beatPreviewUrl: previewUrl || downloadUrl }));
      setMessage('Beat uploaded. Artists can now play and download it.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Beat upload failed.');
    } finally {
      setUploadingBeat(false);
    }
  }
```

Add the import beside the existing `@/src/features/openmic` imports (Task 6 needs it for the warning; see Step 4):

```tsx
import { isLegacyBeatUrl } from '@/src/features/openmic/beat-storage';
```

Narrow the picker to the one format the route accepts — the label at line 319 says `(MP3/WAV)` and line 323 invites `.wav` and `.m4a`, both of which `app/api/admin/open-mic/beats/route.ts` answers with a 400 the form has no copy for. Leave `type="file"` alone (it is a file input; only `accept` narrows it):

```tsx
            <label className="form-label">Upload Beat File (MP3)</label>
            <input
              className="form-input h-[44px] file:mr-3 file:rounded-sm file:border file:border-white/60 file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-foreground"
              type="file"
              accept=".mp3"
```

Change the required-field copy at line 83 so it names the action, not a URL:

```tsx
    if (!String(form.beatDownloadUrl || '').trim()) errors.beatDownloadUrl = 'Upload the official beat mp3.';
```

Below the download-URL input (line 314-316), render the legacy warning when a pasted value is an owner-only path:

```tsx
            {isLegacyBeatUrl(form.beatDownloadUrl) ? (
              <p className="text-[12px] text-amber-400">
                This beat predates the public-beat storage fix and cannot be opened by artists. Re-upload the mp3.
              </p>
            ) : null}
```

- [ ] **Step 4: Rewire the editor**

In `frontend-web/components/openmic/OpenMicAdminContestEditor.tsx`, replace `uploadBeatFile` (lines 58-80) — here the contest exists, so its id namespaces the key:

```tsx
  async function uploadBeatFile(file: File) {
    setUploadingBeat(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/admin/open-mic/beats?contestId=${encodeURIComponent(contest.id)}`, {
        method: 'POST',
        headers: await adminAuthHeaders(false),
        body,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Beat upload failed.');
      const previewUrl = String(payload?.beat?.previewUrl || '');
      const downloadUrl = String(payload?.beat?.downloadUrl || '');
      if (!downloadUrl) throw new Error('Upload succeeded but no beat URL was returned.');
      setForm((prev) => ({ ...prev, downloadUrl, previewUrl: previewUrl || downloadUrl }));
      setMessage('Beat uploaded. Save changes to publish it.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Beat upload failed.');
    } finally {
      setUploadingBeat(false);
    }
  }
```

Add the import:

```tsx
import { isLegacyBeatUrl } from '@/src/features/openmic/beat-storage';
```

and below the download-URL input (line 201) the same warning, phrased for an existing edition:

```tsx
            {isLegacyBeatUrl(form.downloadUrl) ? (
              <p className="form-error">
                This beat was uploaded before the public-beat fix, so artists get an access error. Re-upload the mp3
                and save.
              </p>
            ) : null}
```

Narrow this picker exactly as in Step 3 — the label at line 204 says `(MP3/WAV)` and line 208 invites `.wav` and `.m4a`, both of which the route 400s:

```tsx
            <label className="form-label">Upload Beat File (MP3)</label>
            <input
              className="form-input h-[44px]"
              type="file"
              accept=".mp3"
```

- [ ] **Step 5: Run the guard and the gates**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0, no lint errors.

- [ ] **Step 6: Commit**

```bash
git -C /Users/paymax/Documents/spotlight/main add frontend-web/components/openmic/OpenMicAdminContestBuilder.tsx \
  frontend-web/components/openmic/OpenMicAdminContestEditor.tsx \
  frontend-web/tests/unit/openmic/admin-beat-wiring.spec.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "fix(open-mic): upload contest beats through the public beat route

Both admin forms kept storing the uploader-only URL returned by the
registration documents route, which is why no artist could play a published
beat. Each now warns on a row that still carries one."
```

---

### Task 7: Dev-only edition fixture (no commit — data, not code)

**Files:**
- Scratch only: `/tmp/openmic-fixture.mjs`, `/tmp/spotlight-beat.mp3` (or any real 10–30s mp3 on the machine)

**Interfaces:**
- Consumes: Task 2's upload route (the beat must go through it, not the filesystem), local Supabase via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `frontend-web/.env.local`.
- Produces: the rows every later task verifies against — slug `open-mic-dev`, five board entries, one beat row written by the new route.

- [ ] **Step 1: Confirm the local state you are about to change**

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-web && node -e "
const{readFileSync}=require('fs');const env=readFileSync('.env.local','utf8');
const get=(k)=>(env.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1];
console.log('SUPABASE_URL set:',Boolean(get('NEXT_PUBLIC_SUPABASE_URL')),'SERVICE set:',Boolean(get('SUPABASE_SERVICE_ROLE_KEY')),'ADMIN_KEY set:',Boolean(get('SPOTLIGHT_ADMIN_API_KEY')));
"
```
Expected: booleans only — never print a value. Also confirm nothing is already in the way:
`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/open-mic/open-mic-dev` (a dev server must already be running; if not, start one with `npm run dev`).

- [ ] **Step 2: Insert the edition, its beat row and five entries**

Write `/tmp/openmic-fixture.mjs` (throwaway, service-role REST inserts; note `contests.status` is the `contest_status` enum — `draft|active|upcoming|ended` — while `mapContestRow` reads `sponsor_assets.status` first, so the row carries `'active'` and the assets carry `'voting_live'`):

```js
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('/Users/paymax/Documents/spotlight/main/frontend-web/.env.local', 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const supabase = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const now = new Date();
const iso = (d) => d.toISOString();
const days = (n) => iso(new Date(now.getTime() + n * 86400000));

const { data: contest, error: contestError } = await supabase.from('contests').insert({
  name: 'Spotlight Open Mic (dev edition)',
  slug: 'open-mic-dev',
  description: 'Local fixture for the competition steps work. Not programme data.',
  contest_type: 'one_beat_one_verse',
  status: 'active',
  visibility: 'public',
  category: 'entertainment',
  rules: 'One beat, one verse. Original bars only.',
  start_date: days(-5),
  end_date: days(20),
  entry_fee_ngn: 0,
  vote_price_ngn: 100,
  shortlisting_limit: 10,
  judge_weight: 30,
  public_vote_weight: 70,
  sponsor_assets: {
    month: now.getUTCMonth() + 1,
    year: now.getUTCFullYear(),
    season: 'Season 2',
    status: 'voting_live',
    selectionModel: 'hybrid',
    finalistsTarget: 10,
    submissionStartAt: days(-4),
    submissionEndAt: days(10),
    reviewEndAt: days(14),
    voting: { enabled: true, freeVoting: true, freeVotesPerDay: 3, paidVoting: true, leaderboardVisible: true, voteCountPublic: true, votingStartAt: days(-2), votingEndAt: days(16) },
  },
}).select().single();
if (contestError) throw contestError;

// The beat row is written in step 4, once the upload route has produced a key.

const artists = [
  ['Adaeze Okonkwo', 'Street Light', 412],
  ['Bello Miracle', 'No Go Blind', 388],
  ['Tunde Signals', 'Third Round', 251],
  ['K1ng$hoota', 'Crown Heavy', 190],
  ['Zabbymoney', 'Lagos Sleeps Late', 96],
];
const { error: entriesError } = await supabase.from('competition_entries').insert(
  artists.map(([stageName, songTitle, votes], index) => ({
    competition_id: contest.id,
    user_id: contest.created_by ?? undefined,
    entry_title: songTitle,
    category: 'Hip Hop',
    status: 'published_for_voting',
    public_vote_count: votes,
    leaderboard_score: votes,
    visibility_state: 'public',
    lyrical_concept_summary: JSON.stringify({
      stageName,
      songTitle,
      genre: 'Hip Hop',
      contestSlug: 'open-mic-dev',
      songUrl: '',
      songFileName: `${songTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp3`,
      officialBeatConfirmed: true,
      order: index + 1,
    }),
  })),
);
if (entriesError) throw entriesError;

console.log(JSON.stringify({ contestId: contest.id, entries: artists.length }));
```

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && node /tmp/openmic-fixture.mjs`
Expected: one line of JSON with a `contestId`. Record it — step 4 needs it. If `user_id` is rejected as NOT NULL, re-run with a real `user_profiles.id` from that database rather than inventing a uuid.

- [ ] **Step 3: Prove the route is exercised, not bypassed**

Upload a real mp3 through the new admin route with an admin identity. Prefer the browser (admin console → Open Mic → this edition → upload the beat file) because that is the surface the feature ships on; use the header path only if `SPOTLIGHT_ADMIN_API_KEY` is set, letting the shell read the value from the file so it never lands in your transcript:

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-web && \
KEY=$(node -e "const{readFileSync}=require('fs');const e=readFileSync('.env.local','utf8');process.stdout.write((e.match(/^SPOTLIGHT_ADMIN_API_KEY=(.*)$/m)||[])[1]?.trim()||'')") && \
[ -n "$KEY" ] && curl -s -X POST "http://localhost:3000/api/admin/open-mic/beats?contestId=<contestId>" \
  -H "x-admin-key: $KEY" -H "x-admin-role: admin" \
  -F "file=@/tmp/spotlight-beat.mp3;type=audio/mpeg" ; echo
```
Expected: `{"success":true,"beat":{"objectKey":"openmic-beats/<id>/<uuid>.mp3","previewUrl":"/api/open-mic/beats/…","downloadUrl":"/api/open-mic/beats/…?download=1",…}}`.

- [ ] **Step 4: Store those two paths on the beat row, and prove both dispositions**

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-web && node -e "
const{readFileSync}=require('fs');const env=readFileSync('.env.local','utf8');
const get=(k)=>(env.match(new RegExp('^'+k+'=(.*)\$','m'))||[])[1];
(async()=>{
const {createClient}=await import('@supabase/supabase-js');
const sb=createClient(get('NEXT_PUBLIC_SUPABASE_URL'),get('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
const {error}=await sb.from('competition_beats').upsert({
  competition_id:'<contestId>',title:'Street Light (dev beat)',genre:'Hip Hop',
  producer_credit:'DJ Wole (dev)',preview_url:'<previewUrl from step 3>',
  download_url:'<downloadUrl from step 3>',rules_text:'Original bars only. No clear-text sample packs.',
  requires_enrollment:false,is_active:true,
},{onConflict:'competition_id'});
console.log(error?error.message:'beat row written');
})();"
```

Then assert the public reader answers with no credentials at all:

```bash
curl -s -o /dev/null -w 'inline %{http_code} %{content_type}\n' "http://localhost:3000<previewUrl>"
curl -sI "http://localhost:3000<downloadUrl>" | grep -i 'content-disposition'
curl -s -o /dev/null -w 'private %{http_code}\n' "http://localhost:3000/api/open-mic/beats/$(node -e "process.stdout.write(Buffer.from('registration/x/passport.pdf','utf8').toString('base64url'))")"
```
Expected: `inline 200 audio/mpeg`; `content-disposition: attachment`; `private 404`.

- [ ] **Step 5: Sanity the reads the page will make**

Run: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/open-mic/open-mic-dev` → `200`, and open it in the browser: the beat plays, and the five artists are on the board.

**Nothing in this task is committed.** It is local dev data; say so in the final report so it is not mistaken for programme content.

---

### Task 8: The e2e spec for the five steps (red first)

**Files:**
- Test: `frontend-web/tests/e2e/openmic/competition-steps.spec.ts`

**Interfaces:**
- Consumes: Task 7's fixture (`open-mic-dev`, five entries), Task 9's `#step-N` accordion content, the page's `#route` nav.
- Produces: the acceptance gate Task 9 and Task 10 are measured against.

- [ ] **Step 1: Write the spec**

```ts
/**
 * Steps #01–#05 of the Open Mic programme page, against the local `open-mic-dev`
 * edition (see the plan's Task 7 — dev data, never programme data).
 *
 * The point is that a step is either live or says it is not: no control here may
 * point at a route that 401s, and nothing may print a number the admin switched
 * off. Run with --workers=1 (one `next dev` cannot serve parallel projects).
 */
import { expect, test } from '@playwright/test';

const PAGE = '/service-details/open-mic-competition';
const SLUG = 'open-mic-dev';

async function openStep(page: import('@playwright/test').Page, step: 1 | 2 | 3 | 4 | 5) {
  await page.goto(`${PAGE}#step-${step}`);
  const panel = page.locator(`#step-${step}`);
  await expect(panel).toBeVisible();
  // The page's own hash handler opens the linked accordion once hydrated; click
  // only if it has not, otherwise this would close what the feature just opened.
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await panel.locator('summary').click();
  }
  return panel;
}

test('step 02 plays and downloads the real beat file', async ({ page }) => {
  const panel = await openStep(page, 2);
  const src = await panel.locator('audio source').getAttribute('src');
  expect(src, 'the player must use the public beat reader').toMatch(/^\/api\/open-mic\/beats\//);

  const inline = await page.request.get(src!);
  expect(inline.status()).toBe(200);
  expect(inline.headers()['content-type']).toContain('audio');

  const download = await panel.getByRole('link', { name: /download beat/i }).getAttribute('href');
  expect(download).toContain('?download=1');
  const head = await page.request.get(download!);
  expect(head.status()).toBe(200);
  expect(head.headers()['content-disposition']).toContain('attachment');
});

test('step 03 hands over to the real submission form while the window is open', async ({ page }) => {
  const panel = await openStep(page, 3);
  await expect(panel.getByRole('link', { name: /submit your song/i })).toHaveAttribute(
    'href',
    `/open-mic/${SLUG}/enter`,
  );
  await expect(panel, 'the real cap, not prose').toContainText('50MB');
});

test('step 04 is honest when nobody is signed in', async ({ page }) => {
  const panel = await openStep(page, 4);
  await expect(panel).toContainText(/appears here once your entry is live/i);
  await expect(panel.locator('a[href*="/entry/"]'), 'never a fabricated link').toHaveCount(0);
});

test('step 05 shows the top five with counts and a way to vote', async ({ page }) => {
  const panel = await openStep(page, 5);
  await expect(panel.locator('li[data-rank]')).toHaveCount(5);
  await expect(panel.locator('li[data-rank="1"]')).toContainText('Adaeze Okonkwo');
  await expect(panel.getByRole('link', { name: /vote now/i })).toHaveAttribute('href', `/open-mic/${SLUG}/entries`);
});

test('the closing call to action reaches the open mic board, not the STEM plane', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('a[href="/voting"]'), 'this page has nothing to do with /voting').toHaveCount(0);
  await expect(page.getByRole('link', { name: /go to voting/i })).toHaveAttribute('href', `/open-mic/${SLUG}/entries`);
});
```

- [ ] **Step 2: Run it to verify it fails for the right reason**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx playwright test tests/e2e/openmic/competition-steps.spec.ts --workers=1 --project=chromium-desktop`
Expected: FAIL — today's `#step-2` accordion contains only prose (`audio source` resolves to nothing). If it fails with `/open-mic/open-mic-dev` 404 instead, Task 7's fixture is missing; fix that first, because a red test for the wrong reason proves nothing.

- [ ] **Step 3: Commit the spec as the failing gate**

```bash
git -C /Users/paymax/Documents/spotlight/main add frontend-web/tests/e2e/openmic/competition-steps.spec.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "test(open-mic): acceptance spec for the five competition steps

Currently red: the accordions render prose, so no step 02 audio, no download
disposition, no ranked board."
```

---

### Task 9: The live steps block

**Files:**
- Create: `frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx`
- Create: `frontend-web/components/openmic/competition/edition-steps.module.css`

**Interfaces:**
- Consumes: Task 5's `OpenMicEditionStepsData`, including that `data.board` is `null` when the board could not be read, `{rows: [], …}` when the edition has no entries yet, and otherwise already cut to five in the store's standing order — the four render branches at step #05 map those three facts plus "standings hidden" one-to-one, and no branch may print a number for a `null` board. `rank` is the store's composite standing (judges + votes), so nothing here may call it "most voted". Task 1's `publicBeatUrl` (already applied server-side — this component never re-derives availability); `createClient` from `@/lib/supabase/client` for the signed-in entry lookup; `slugifyArtist` from `@/src/features/openmic/workflow`; `GET /api/open-mic/submissions?contestId=<id>` (bearer, already filtered to `user.id`).
- Produces: `OpenMicEditionSteps({ data })`, a client component rendering `<section id="route">` with `#step-1…#step-5`. Task 10 renders it from the view.

- [ ] **Step 1: Write the styles for what today's CSS has no rule for**

Create `frontend-web/components/openmic/competition/edition-steps.module.css`. The page keeps its own `openMic-*` classes for layout; this module covers only the new bits (a `.module.css` is the idiom already used by `app/service-details/film-academy/*`, and it avoids touching `open-mic.css`, which another session has in flight):

```css
/* Live content inside the five step accordions. */
.stepState { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; margin: 14px 0; font-size: 14px; }
.stepState b { font-weight: 700; }
.windowOpen { color: #1f7a3d; }
.windowClosed { color: #8a3b12; }

.beatPlayer { margin: 16px 0 12px; }
.beatPlayer audio { width: 100%; }
.beatCredit { margin: 8px 0 0; font-size: 13px; color: #4d4a45; }

.board { list-style: none; margin: 18px 0; padding: 0; border-top: 1px solid rgba(20, 18, 15, .14); }
.board li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(20, 18, 15, .14); }
.board .rank { font-size: 15px; font-weight: 800; color: #a2601b; }
.board .who { min-width: 0; }
.board .who strong { display: block; font-size: 15px; }
.board .who span { display: block; font-size: 13px; color: #5d5952; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board .votes { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.board .link { grid-column: 1 / -1; font-size: 13px; }

.tally { margin: 0 0 4px; font-size: 13px; color: #4d4a45; }
.note { margin: 12px 0 0; font-size: 13px; color: #4d4a45; }
.entryLink { display: block; margin: 10px 0; font-size: 13px; word-break: break-all; }

@media (max-width: 680px) {
  .board li { grid-template-columns: 28px minmax(0, 1fr) auto; }
}
```

- [ ] **Step 2: Write the component**

Create `frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { OpenMicEditionStepsData } from '@/src/features/openmic/active-edition';
import { slugifyArtist } from '@/src/features/openmic/workflow';
import styles from './edition-steps.module.css';

/**
 * The five-step route, rendered from one server read. Where the platform cannot
 * honour a step there is no control, only the reason — the bug this replaced
 * was a page of prose pointing at nothing, plus a download that 403'd for every
 * artist but the admin who uploaded the file.
 */
const STEPS = [
  { title: 'Register as an artist', description: 'Enter the current edition from the official application page. Registration may be free or carry a fee — whichever the edition states.', preparation: 'Your artist name and an active contact channel.' },
  { title: 'Get the Spotlight beat', description: 'Play the official instrumental for this edition, then download the mp3 and write your bars to it.', preparation: 'Headphones, a quiet room and the round’s usage rules.' },
  { title: 'Make and submit a song', description: 'Record your original verse over the beat and upload the mp3 from the entry form.', preparation: 'A clear recording, ready for the deadline.' },
  { title: 'Share and rally votes', description: 'Once your entry is live it gets its own page. Share that link and ask your people to vote.', preparation: 'Your official entry link.' },
  { title: 'Leaderboard and the monthly winner', description: 'Public votes and judging decide who takes the stage. Watch the board, then follow the winner announcement.', preparation: 'Nothing — bring your fans.' },
] as const;

const MAX_MP3_MB = 50;

type WindowState = 'open' | 'not-started' | 'closed' | 'unknown';

function windowState(start: string | null, end: string | null, now: number): WindowState {
  const from = start ? Date.parse(start) : Number.NaN;
  const to = end ? Date.parse(end) : Number.NaN;
  if (!Number.isFinite(from) && !Number.isFinite(to)) return 'unknown';
  if (Number.isFinite(from) && now < from) return 'not-started';
  if (Number.isFinite(to) && now > to) return 'closed';
  return 'open';
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBC';

function WindowLine({ label, start, end, state }: { label: string; start: string | null; end: string | null; state: WindowState }) {
  return (
    <p className={styles.stepState}>
      <b>{label}</b>
      <span>{shortDate(start)} → {shortDate(end)}</span>
      <span className={state === 'open' ? styles.windowOpen : styles.windowClosed}>
        {state === 'open' ? '· open now' : state === 'not-started' ? '· opens later' : state === 'closed' ? '· closed' : '· dates to be confirmed'}
      </span>
    </p>
  );
}

/** Step 04 is the only one the server cannot answer: whose entry it is depends
 *  on who is signed in. */
function OwnEntry({ contestId, contestSlug }: { contestId: string; contestSlug: string }) {
  const [entry, setEntry] = useState<{ stageName: string; songTitle: string; voteCount: number } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        if (active) setChecked(true);
        return;
      }
      try {
        const res = await fetch(`/api/open-mic/submissions?contestId=${encodeURIComponent(contestId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = (await res.json().catch(() => null)) as { submissions?: any[] } | null;
        const live = (payload?.submissions ?? []).find((row) =>
          ['published_for_voting', 'live_for_voting', 'finalist', 'winner'].includes(String(row.status))
        );
        if (active && live) setEntry({ stageName: live.stageName, songTitle: live.songTitle, voteCount: Number(live.voteCount || 0) });
      } finally {
        if (active) setChecked(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [contestId]);

  if (!entry) {
    return (
      <p className={styles.note}>
        {checked
          ? 'Your entry link appears here once your entry is live for voting. Until then, register and submit from the steps above.'
          : 'Checking your entries…'}
      </p>
    );
  }
  const path = `/open-mic/${contestSlug}/entry/${slugifyArtist(entry.stageName)}`;
  const url = typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
  return (
    <>
      <p className={styles.tally}>Your entry: <strong>{entry.stageName}</strong> — “{entry.songTitle}” · {entry.voteCount.toLocaleString()} votes so far</p>
      <code className={styles.entryLink}>{url}</code>
      <div className="openMic-actions">
        <Link className="openMic-button openMic-buttonOutline" href={path}>Open your entry page <span aria-hidden="true">→</span></Link>
      </div>
    </>
  );
}

export default function OpenMicEditionSteps({ data }: { data: OpenMicEditionStepsData | null }) {
  const [activeStage, setActiveStage] = useState<string | null>('step-1');
  const now = Date.now();

  useEffect(() => {
    function openLinkedStage() {
      const stageId = window.location.hash;
      if (!/^#step-[1-5]$/.test(stageId)) return;
      const stage = document.querySelector<HTMLDetailsElement>(stageId);
      if (stage) stage.open = true;
    }
    window.addEventListener('hashchange', openLinkedStage);
    openLinkedStage();
    return () => window.removeEventListener('hashchange', openLinkedStage);
  }, []);

  const registration = windowState(data?.registrationStartAt ?? null, data?.registrationEndAt ?? null, now);
  const submission = windowState(data?.submissionStartAt ?? null, data?.submissionEndAt ?? null, now);
  const voting = windowState(data?.votingStartAt ?? null, data?.votingEndAt ?? null, now);
  const beat = data?.beat ?? null;
  const board = data?.board ?? null;

  return (
    <section className="openMic-wrap openMic-sectionPad openMic-route" id="route">
      <p className="openMic-kicker">02 / THE COMPETITION ROUTE</p>
      <h2>From beat to winner.</h2>
      <p className="openMic-sectionLead">
        {data ? `${data.title} — choose a step to see what happens and what to prepare.` : 'Choose a step to see what happens and what to prepare.'}
      </p>

      <nav className="openMic-infographic" aria-label="Competition stages">
        {STEPS.map((stage, index) => (
          <a key={stage.title} href={`#step-${index + 1}`} aria-current={activeStage === `step-${index + 1}` ? 'step' : undefined}>
            <span>0{index + 1}</span>{stage.title}
          </a>
        ))}
      </nav>

      <div className="openMic-playbook">
        <div className="openMic-routeLabel"><span>THE PLAYBOOK</span><span>01–05</span></div>
        {STEPS.map((stage, index) => {
          const id = `step-${index + 1}`;
          return (
            <details
              key={stage.title}
              id={id}
              name="open-mic-route"
              open={index === 0}
              onToggle={(event) => {
                if (event.currentTarget.open) setActiveStage(event.currentTarget.id);
                else if (activeStage === event.currentTarget.id) setActiveStage(null);
              }}
            >
              <summary>0{index + 1}<strong>{stage.title}</strong></summary>
              <div className="openMic-stage">
                <p>{stage.description}</p>

                {index === 0 && (
                  data ? (
                    <>
                      <WindowLine label="Registration" start={data.registrationStartAt} end={data.registrationEndAt} state={registration} />
                      <p className={styles.tally}>
                        {data.entryFeeRequired
                          ? `Registration fee: ₦${data.registrationFeeNgn.toLocaleString()}.`
                          : 'Registration for this edition is free.'}
                      </p>
                      <div className="openMic-actions">
                        <Link className="openMic-button openMic-buttonPrimary" href={`/open-mic/${data.slug}/apply`}>Register as an artist <span aria-hidden="true">→</span></Link>
                      </div>
                    </>
                  ) : (
                    <p className={styles.note}>No edition is open right now — the next one is announced here and on the Open Mic page.</p>
                  )
                )}

                {index === 1 && (
                  /* A beat can be downloadable with no preview path set, and
                     playable with download switched off — so gate on either and
                     render each control on its own. */
                  beat && (beat.previewUrl || beat.downloadUrl) ? (
                    <div className={styles.beatPlayer}>
                      {beat.previewUrl ? (
                        <audio controls preload="none">
                          <source src={beat.previewUrl} type="audio/mpeg" />
                          Your browser cannot play the beat; use the download below.
                        </audio>
                      ) : null}
                      <p className={styles.beatCredit}>
                        {beat.title}{beat.producerCredit ? ` · produced by ${beat.producerCredit}` : ''}
                        {beat.usageRules ? ` — ${beat.usageRules}` : ''}
                      </p>
                      {beat.requiresPaidEntry ? (
                        <p className={styles.note}>The file unlocks once your entry fee is paid — register first, then download.</p>
                      ) : beat.downloadable && beat.downloadUrl ? (
                        <div className="openMic-actions">
                          <a className="openMic-button openMic-buttonOutline" href={beat.downloadUrl} download={`${slugifyArtist(beat.title) || 'spotlight-beat'}.mp3`}>Download beat <span aria-hidden="true">↓</span></a>
                        </div>
                      ) : (
                        <p className={styles.note}>Preview only for this edition — the download is not open.</p>
                      )}
                    </div>
                  ) : (
                    <p className={styles.note}>The beat for this edition drops here — hear it before you write.</p>
                  )
                )}

                {index === 2 && (
                  data ? (
                    <>
                      <WindowLine label="Submission window" start={data.submissionStartAt} end={data.submissionEndAt} state={submission} />
                      <p className={styles.tally}>Format: MP3 up to {MAX_MP3_MB}MB, recorded over this edition’s beat.</p>
                      <div className="openMic-actions">
                        <Link
                          className="openMic-button openMic-buttonPrimary"
                          href={submission === 'open' ? `/open-mic/${data.slug}/enter` : `/open-mic/${data.slug}/entries`}
                        >
                          {submission === 'open' ? 'Submit your song' : 'See the live entries'} <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </>
                  ) : (
                    <p className={styles.note}>Submit your song from the Open Mic page when an edition is live.</p>
                  )
                )}

                {index === 3 && (data ? <OwnEntry contestId={data.id} contestSlug={data.slug} /> : <p className={styles.note}>Your entry link appears here once an edition is live and you have entered.</p>)}

                {index === 4 && (
                  data ? (
                    <>
                      <WindowLine label="Voting window" start={data.votingStartAt} end={data.votingEndAt} state={voting} />
                      {!data.showLeaderboard ? (
                        <p className={styles.note}>This edition keeps its standings private until the results are announced.</p>
                      ) : !board ? (
                        <p className={styles.note}>Standings are unavailable right now. Try the leaderboard again in a moment.</p>
                      ) : board.rows.length === 0 ? (
                        <p className={styles.note}>The board fills in when entries go live for voting.</p>
                      ) : (
                        <>
                          <p className={styles.tally}>
                            {board.entryCount} {board.entryCount === 1 ? 'entry' : 'entries'} on the board
                            {data.showVoteCounts ? ` · ${board.totalVotes.toLocaleString()} votes counted` : ''}
                          </p>
                          <ol className={styles.board}>
                            {board.rows.map((row) => (
                              <li key={row.artistSlug} data-rank={row.rank}>
                                <span className={styles.rank}>{row.rank}</span>
                                <span className={styles.who}>
                                  <strong>{row.stageName}</strong>
                                  <span>{row.songTitle}</span>
                                </span>
                                <span className={styles.votes}>{data.showVoteCounts ? `${row.voteCount.toLocaleString()} votes` : '—'}</span>
                                <span className={styles.link}>
                                  <Link href={`/open-mic/${data.slug}/entry/${row.artistSlug}`}>Hear it and vote</Link>
                                </span>
                              </li>
                            ))}
                          </ol>
                          <div className="openMic-actions">
                            <Link className="openMic-button openMic-buttonPrimary" href={`/open-mic/${data.slug}/entries`}>Vote now <span aria-hidden="true">→</span></Link>
                          </div>
                        </>
                      )}
                      <div className="openMic-actions">
                        <Link className="openMic-button openMic-buttonOutline" href={`/open-mic/${data.slug}/entries`}>Full leaderboard <span aria-hidden="true">→</span></Link>
                      </div>
                    </>
                  ) : (
                    <p className={styles.note}>Standings appear here while an edition is running.</p>
                  )
                )}

                <p><b>PREPARE</b>{stage.preparation}</p>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Compile and lint the new component**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx tsc --noEmit && npx eslint components/openmic/competition`
Expected: exit 0 for both. (`next.config` types `*.module.css` through the built-in plugin; if `tsc` complains about the `styles` import, the project already has `next-env.d.ts` pulling in `next/env` typings — check how `app/service-details/film-academy/TuitionPlanner.tsx` imports its module CSS and match that exact form. Do not add a CSS type declaration file.)

- [ ] **Step 4: Commit (behaviour is gated in Task 10, which mounts it)**

```bash
git -C /Users/paymax/Documents/spotlight/main add frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx \
  frontend-web/components/openmic/competition/edition-steps.module.css
git -C /Users/paymax/Documents/spotlight/main commit -m "feat(open-mic): live five-step competition block for the programme page

Beat player and download, submission window, the signed-in visitor's own entry
link and a top-five board — each step degrades to the reason it is not live
rather than a control that would fail."
```

---

### Task 10: Mount the steps — server read, client shell

**Files:**
- Modify: `frontend-web/app/service-details/open-mic-competition/page.tsx` (becomes a server component)
- Create: `frontend-web/components/openmic/competition/OpenMicCompetitionView.tsx` (today's markup, moved)

**Interfaces:**
- Consumes: Task 5's `loadOpenMicEditionSteps()`; Task 9's `OpenMicEditionSteps`.
- Produces: the shipped page. No new interfaces.

- [ ] **Step 1: GATE — check nobody else's work is still in the two files you are about to move**

```bash
cd /Users/paymax/Documents/spotlight/main && git status --porcelain -- frontend-web/app/service-details/open-mic-competition/page.tsx frontend-web/app/service-details/open-mic-competition/open-mic.css && git log --oneline -1 -- frontend-web/app/service-details/open-mic-competition/page.tsx
```

If `page.tsx` is still listed as modified — it carries another session's uncommitted lounge-application feature (~231 insertions plus the untracked `app/api/open-mic/lounge-applications/`): **STOP this task and report it.** Relocating their uncommitted code into a new file and committing it under this plan's message would rewrite someone else's in-flight work. Task 9 is already merged and the rest of the plan still stands; only the mount waits.

Proceed only when that path is clean (their work landed), and re-read the file first — the line numbers below are from the working tree at the time of writing (835 lines) and will have moved.

- [ ] **Step 2: Move the markup to the client shell**

Copy the current `page.tsx` to `frontend-web/components/openmic/competition/OpenMicCompetitionView.tsx` **verbatim** (it already starts with `'use client'`), then make exactly four edits:

1. Drop `import './open-mic.css';` (the route folder's CSS is imported by the server page now, so the shell has no relative path to it).
2. Delete the `stages` const (the five prose objects, currently lines 12-43) — `OpenMicEditionSteps` owns that copy now.
3. Change the default export to take the data and forward it, and replace the whole `<section … id="route">…</section>` block (currently lines 676-715) with the new component:

```tsx
import OpenMicEditionSteps from './OpenMicEditionSteps';
import type { OpenMicEditionStepsData } from '@/src/features/openmic/active-edition';

type Props = { data: OpenMicEditionStepsData | null };

export default function OpenMicCompetitionView({ data }: Props) {
```

   ```tsx
        <OpenMicEditionSteps data={data} />
   ```

4. Repoint the closing "Go to voting" CTA (currently line 818, `href="/voting"` — `/voting` is the STEM plane and has nothing to do with Open Mic):

```tsx
              <a className="openMic-button openMic-buttonOutline" href={data ? `/open-mic/${data.slug}/entries` : '/open-mic'}>
                Go to voting <ArrowIcon />
              </a>
```

The `useState`/`useEffect` hash-open logic and `activeStage` now live in `OpenMicEditionSteps`; remove the now-unused copies from the shell (currently lines 587-600) so lint does not flag them, and drop `useEffect` from the shell's React import if nothing else uses it.

- [ ] **Step 3: Rewrite the page as the server read**

Replace `frontend-web/app/service-details/open-mic-competition/page.tsx` in full:

```tsx
import OpenMicCompetitionView from '@/components/openmic/competition/OpenMicCompetitionView';
import { loadOpenMicEditionSteps } from '@/src/features/openmic/active-edition';
import './open-mic.css';

export const dynamic = 'force-dynamic';

/**
 * Server read, client shell: the five steps carry live edition state (beat,
 * windows, standings) that has to come from Supabase, while the page keeps the
 * hash-opened accordions, the lounge dialog and the carousel exactly as they
 * were. Metadata stays in layout.tsx.
 */
export default async function OpenMicCompetitionPage() {
  const data = await loadOpenMicEditionSteps();
  return <OpenMicCompetitionView data={data} />;
}
```

- [ ] **Step 4: Turn the Task 8 spec green**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx playwright test tests/e2e/openmic/competition-steps.spec.ts --workers=1 --project=chromium-desktop`
Expected: PASS (5 tests). Then the mobile project too:
`npx playwright test tests/e2e/openmic/competition-steps.spec.ts --workers=1 --project=mobile-chrome`
Expected: PASS.

- [ ] **Step 5: Browser pass, desktop and 390px**

Open `http://localhost:3000/service-details/open-mic-competition` and click through #01–#05: play the beat, download it, land on `/open-mic/open-mic-dev/enter`, open an entry link from the board, and confirm the hero, stats, testimonials carousel, lounge dialog, prizes and footer are untouched by the move. Screenshots to `/tmp/shots/`.

- [ ] **Step 6: Commit the two files together (one logical change)**

```bash
cd /Users/paymax/Documents/spotlight/main && git add \
  frontend-web/app/service-details/open-mic-competition/page.tsx \
  frontend-web/components/openmic/competition/OpenMicCompetitionView.tsx && git diff --cached --name-only -- frontend-web/app/service-details/open-mic-competition/page.tsx frontend-web/components/openmic/competition/OpenMicCompetitionView.tsx
git -C /Users/paymax/Documents/spotlight/main commit -m "feat(open-mic): drive the programme page steps from the current edition

The page reads the database once and hands a serialisable snapshot to the
client shell; the wrong /voting hand-off is repointed at the edition's board."
```

---

### Task 11: Full gates on the shipped tree

**Files:** none — verification only.

- [ ] **Step 1: Run every CI step the frontend-web lane runs, plus the new tests**

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-web && \
npx vitest run tests/unit/media/open-mic-beat-storage.test.ts tests/unit/openmic && \
npm run test:regression && npm run test:money && npx vitest run tests/unit/config && \
npm run contract:check && npx tsc --noEmit && npm run lint && \
npx eslint tests/unit/media/open-mic-beat-storage.test.ts tests/unit/openmic tests/e2e/openmic
```
Expected: every command exits 0.

`npm run lint` is `eslint app components lib src` — it never looks at `tests/**`, so the specs this plan
adds are linted only by the explicit final command above. Keep both: dropping the last one leaves four new
test files outside every CI lane's lint step.

- [ ] **Step 2: Production build into a scratch dir (never clobber the shared dev `.next`)**

`next.config.js:39` already reads `distDir: process.env.DIST_DIR || '.next'`, so this is the exact switch — no config edit:

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-web && \
DIST_DIR=$(mktemp -d) NODE_OPTIONS=--max-old-space-size=8192 npm run build; echo "build exit: $?"
```
Expected: `build exit: 0`, and the running dev server's `.next` untouched. If the build dies with a heap exit (code 134) that is the memory ceiling, not a type error: raise `--max-old-space-size` and re-run — and report which run produced the green.

- [ ] **Step 3: Confirm the committed tree is exactly this session's work**

```bash
cd /Users/paymax/Documents/spotlight/main && git status --porcelain | grep -v "^??" | head -20 && git log --oneline -8
```
Expected: the other sessions' files (`app/apply/[slug]/page.js`, `app/service-details/film-academy/*`, `components/layout/Menu.js`, `src/styles/tailwind.css`, `tests/unit/utility/*`, and either `page.js`'s deletion or the lounge files) still show as they did before this plan started, and the eight-or-so commits above are only this plan's paths.

- [ ] **Step 4: Report, then ask before pushing**

State: what went green and how it was proven; the dev-only rows and beat file left behind in Task 7 (and that nothing was written to production); that `tests/unit/openmic` + `tests/unit/media` are not in a CI lane and offer that as a follow-up; and the four pre-existing bugs the spec names (drawer `.mean-nav` off-panel at 390px, `src/components/Header.tsx:33` → `/contestant-leaderboard` with no route, Footer2 dark-on-dark links, `components/sections/Service3.js:16` → the `/service` page pending deletion under task #127). Do not push without the user's go-ahead.

---

## Self-review notes

- **Spec coverage:** B/C → Task 1–2; D → Task 2 + Task 6; E → Task 1 (`publicBeatUrl`), Task 3 (edition page), Task 5 (data), Task 6 (admin warnings); F → Task 10; G → Task 4; H/H2 → Tasks 5 + 9; I → Task 5 (`slugifyArtist` in the builder, so the client never re-slugs) and Task 9's own entry link; J → Task 7; Testing → Tasks 1–8, 11. Out-of-scope items are untouched.
- **Four deltas folded in from research, overriding the spec's wording:** the real contest type is `one_beat_one_verse` (not `open_mic`); `previewOnly` is hardcoded `false` on the DB path, so `is_active → allowDownload` is the only download switch that exists; the status allowlist widened from 4 to 9 because the narrow list blanks the page during `beat_available`/`submission_closed`/`under_review`; the upload route's `contestId` is optional and token-validated because the builder uploads before the contest row exists, and the accepted MIME set is `audio/mp3|audio/mpeg` because that is what browsers actually report.
- **No placeholders:** every code block is the code. The only run-time values are Task 7's `<contestId>` / `<previewUrl>` / `<downloadUrl>` substitutions, and each names the command immediately above that prints it.
- **Five deltas folded in from research, overriding the spec's wording:** the real contest type is `one_beat_one_verse` (not `open_mic`); `previewOnly` is hardcoded `false` on the DB path, so `is_active → allowDownload` is the only download switch that exists; the status allowlist widened from 4 to 9 because the narrow list blanks the page during `beat_available`/`submission_closed`/`under_review`; the upload route's `contestId` is optional and token-validated because the builder uploads before the contest row exists, and the accepted MIME set is `audio/mp3|audio/mpeg` because that is what browsers actually report; and the download filename comes from the anchor's `download` attribute (which the browser honours) rather than the reader route, because the reader only ever sees the uuid object key — the spec's "derived from the beat title" cannot be done there.
- **Spec line references are stale by design:** they were taken from the committed page (701 lines) while the working tree now has 835 after another session's lounge-application work. This plan quotes the working-tree numbers and re-checks them at Task 10 Step 1.
