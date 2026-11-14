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
| `frontend-web/components/openmic/OpenMicAdminContestBuilder.tsx`<br>`frontend-web/components/openmic/OpenMicAdminContestEditor.tsx` | Upload to the new route, store reader paths, warn on a legacy beat. **Unreachable in this repo** — ADR-047 deleted `frontend-web/app/admin`, and nothing else imports them (Task 6 review, I-1). Kept as the wiring for any console that mounts them again. | Task 6 |
| `frontend-admin/app/admin/open-mic/new/page.tsx`<br>`frontend-admin/app/admin/open-mic/[id]/page.tsx` | The console operators actually use. Gains the beat file picker and the same two warnings, so an edition can be given a beat an artist can open. | Task 6b |
| `frontend-admin/src/services/openMicAdminService.ts` | `uploadOpenMicBeat()` over the web proxy — the one write the Path-A port deliberately skipped. | Task 6b |
| `frontend-admin/tests/admin/openmic/beat-upload.test.tsx` | Behavioural guard (jsdom + testing-library): picking a file posts multipart to the beat route through the proxy and fills both fields. | Task 6b |
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
 *  the board's numbers are decided server-side, and so is which side of each
 *  window the clock is on — Task 9b moved that arithmetic here, because a
 *  client computing it during render pre-renders one answer and hydrates
 *  another. No Date objects: this crosses the server/client boundary. */
export type OpenMicEditionStepsData = {
  id: string;
  slug: string;
  title: string;
  status: OpenMicContest['status'];
  registrationStartAt: string | null;
  registrationEndAt: string | null;
  registrationState: WindowState;
  submissionStartAt: string | null;
  submissionEndAt: string | null;
  submissionState: WindowState;
  votingStartAt: string | null;
  votingEndAt: string | null;
  votingState: WindowState;
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
- Modify: `frontend-web/components/openmic/OpenMicAdminContestBuilder.tsx:87-115` (upload), `:83` (required-field copy), `:312-317` (download-URL field: placeholder, help, two warnings), `:319`/`:323` (label + `accept`), `:332-335` (preview-URL field: placeholder + warning)
- Modify: `frontend-web/components/openmic/OpenMicAdminContestEditor.tsx:58-80` (upload), `:199-202` (download-URL field: placeholder + two warnings), `:204`/`:208` (label + `accept`)
- Test: `frontend-web/tests/unit/openmic/admin-beat-wiring.spec.ts`

**Interfaces:**
- Consumes: Task 2's `POST /api/admin/open-mic/beats` response `{ success, beat: { previewUrl, downloadUrl } }`; `adminAuthHeaders(false)` from `@/src/lib/auth/client` (Authorization + role header, no Content-Type, so FormData still works); Task 1's `isLegacyBeatUrl` (the pre-fix case) and `publicBeatUrl` (the general "will this play for an artist?" question).
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

  it('stores the reader paths the route returns, and refuses to store nothing', () => {
    for (const source of [BUILDER, EDITOR]) {
      expect(source).toMatch(/payload\?\.beat\?\.previewUrl|beat\.previewUrl/);
      expect(source).toMatch(/beat\.downloadUrl|payload\?\.beat\?\.downloadUrl/);
      // Without this, a 201 whose payload lost the URL writes an empty
      // beatDownloadUrl, submit() then complains about a field the admin just
      // filled with a successful upload.
      expect(source).toMatch(/if \(!downloadUrl\) throw/);
    }
  });

  it('warns an admin re-opening a legacy edition instead of leaving it silent', () => {
    // Call sites, not identifiers: an import that is never called would satisfy
    // toContain('isLegacyBeatUrl') while rendering no warning at all.
    expect(BUILDER).toContain('isLegacyBeatUrl(form.beatDownloadUrl)');
    expect(EDITOR).toContain('isLegacyBeatUrl(form.downloadUrl)');
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

  it('flags any pasted URL an artist cannot open, not only a legacy one', () => {
    // isLegacyBeatUrl is an admin diagnostic for the pre-fix upload path; it
    // deliberately does not answer "will this play for an artist?". The public
    // reader allowlists /api/open-mic/beats/, so an absolute third-party URL —
    // exactly what placeholder="https://..." advertises — is unusable while
    // looking perfectly fillable. Both forms must ask publicBeatUrl.
    //
    // Each call site names the field it guards, so a preview URL cannot be
    // swapped into the download field (or vice versa) and still pass.
    expect(BUILDER).toContain('publicBeatUrl(form.beatDownloadUrl) === null');
    expect(BUILDER).toContain('publicBeatUrl(form.beatPreviewUrl) === null');
    expect(EDITOR).toContain('publicBeatUrl(form.downloadUrl) === null');
    for (const source of [BUILDER, EDITOR]) {
      expect(source).not.toContain('placeholder="https://..."');
      expect(source).toMatch(/Upload the mp3\s+instead/i);
    }
    // The help copy that made pasting an off-site URL look like a supported path.
    expect(BUILDER).not.toContain('You can paste a direct URL');
  });

  it('authorises the upload without declaring a content type', () => {
    // The two regressions that actually break a beat upload, and neither is a
    // type error: no header at all is a 401, and adminAuthHeaders(true) adds
    // Content-Type: application/json, which overrides the FormData's multipart
    // boundary and makes the route answer 400 "Expected a multipart upload".
    // The submit calls use (true) — those are JSON — so match the (false) form
    // of the header line itself, not just the identifier.
    for (const source of [BUILDER, EDITOR]) {
      expect(source).toMatch(/headers:\s*await adminAuthHeaders\(false\)/);
    }
    expect(EDITOR).toContain('contestId=${encodeURIComponent(contest.id)}');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic/admin-beat-wiring.spec.ts`
Expected: FAIL — all 6 cases. Today both forms post to `/api/registration/uploads` and store `payload?.upload?.previewUrl`, neither imports a predicate, both accept `.wav`/`.m4a`, and the builder still carries `placeholder="https://..."`. (The builder's old `fetch` also sends no auth header at all — `adminAuthHeaders(false)` in Step 3 is what makes the upload work for a signed-in admin.)

**When strengthening this guard on sources that already pass it** (a review round, not a first implementation): a green run proves nothing about the new assertions. After they pass, prove each one bites by introducing the regression it exists for, watching that case fail, then reverting — delete `headers: await adminAuthHeaders(false)` (must fail case 6), change it to `(true)` (must fail case 6), replace `isLegacyBeatUrl(form.beatDownloadUrl)` with `isLegacyBeatUrl(form.beatPreviewUrl)` (must fail case 3), delete `if (!downloadUrl) throw` (must fail case 2). Report each mutation with the case it failed.

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

Add the import beside the existing `@/src/features/openmic` imports — both predicates, because they answer two different questions (`beat-storage.ts:65-74` says so in as many words: `isLegacyBeatUrl` is the pre-fix diagnostic, `publicBeatUrl` is "will an artist be able to open this?"):

```tsx
import { isLegacyBeatUrl, publicBeatUrl } from '@/src/features/openmic/beat-storage';
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

Rewrite the download-URL field (lines 312-317). Two hazards live here: the `placeholder="https://..."` plus help copy advertise pasting an arbitrary direct URL, which Task 1's allowlist refuses at read time — so the admin fills the field, saves, and the edition page quietly shows no beat. One warning per URL field, the legacy case first:

```tsx
          <div className="md:col-span-2">
            <label className="form-label">Beat File URL (Download)*</label>
            <input className="form-input h-[44px]" value={form.beatDownloadUrl} onChange={(e) => setField('beatDownloadUrl', e.target.value)} placeholder="/api/open-mic/beats/…" />
            <p className="form-help">The upload below fills this. Artists can only open a beat this site stores.</p>
            {validationErrors.beatDownloadUrl ? <p className="form-error">{validationErrors.beatDownloadUrl}</p> : null}
            {isLegacyBeatUrl(form.beatDownloadUrl) ? (
              <p className="text-[12px] text-amber-400">
                This beat predates the public-beat storage fix, so artists get an access error. Re-upload the mp3.
              </p>
            ) : form.beatDownloadUrl && publicBeatUrl(form.beatDownloadUrl) === null ? (
              <p className="text-[12px] text-amber-400">
                The programme page cannot serve that address, so the beat will not play or download. Upload the mp3
                instead of pasting a URL.
              </p>
            ) : null}
          </div>
```

And the preview-URL field (lines 332-335), which has the same placeholder. It is optional and `submit()` already falls back to the download URL (`:157`), so an empty value is fine and only a pasted unusable one needs saying:

```tsx
          <div className="md:col-span-2">
            <label className="form-label">Beat Preview URL (Optional)</label>
            <input className="form-input h-[44px]" value={form.beatPreviewUrl} onChange={(e) => setField('beatPreviewUrl', e.target.value)} placeholder="/api/open-mic/beats/…" />
            {form.beatPreviewUrl && publicBeatUrl(form.beatPreviewUrl) === null ? (
              <p className="text-[12px] text-amber-400">
                The player ignores a preview it cannot serve. Upload the mp3 instead of pasting a URL, or leave this
                empty to play the download file.
              </p>
            ) : null}
          </div>
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
import { isLegacyBeatUrl, publicBeatUrl } from '@/src/features/openmic/beat-storage';
```

Then rewrite the download-URL field (lines 199-202). This editor loads an existing edition, so it is the surface most likely to show a legacy row — and it has no `validationErrors` on this field, so the warning is the only feedback an admin gets. `previewUrl` exists in state here (`:50`, `:72`, `:120`) but has no input, so only the download field needs the pair:

```tsx
          <div className="md:col-span-2">
            <label className="form-label">Beat Download URL (used by frontend download button)</label>
            <input className="form-input h-[44px]" value={form.downloadUrl} onChange={(e) => setField('downloadUrl', e.target.value)} placeholder="/api/open-mic/beats/…" />
            {isLegacyBeatUrl(form.downloadUrl) ? (
              <p className="form-error">
                This beat was uploaded before the public-beat fix, so artists get an access error. Re-upload the mp3
                and save.
              </p>
            ) : form.downloadUrl && publicBeatUrl(form.downloadUrl) === null ? (
              <p className="form-error">
                The programme page cannot serve that address, so the beat will not play or download. Upload the mp3
                instead of pasting a URL, then save.
              </p>
            ) : null}
          </div>
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

### Task 6b: Give the console operators actually use a beat artists can open

**Why this task exists — a premise in the design doc is false.** The spec's diagnosis
section says "Both admin surfaces upload the beat through `POST /api/registration/uploads`
… (`OpenMicAdminContestBuilder.tsx:87-115`, `OpenMicAdminContestEditor.tsx:58-80`)". Only one
admin surface is reachable: ADR-047 deleted `frontend-web/app/admin` (confirmed — `ls` returns
"No such file or directory", and a repo-wide grep for `OpenMicAdminContest` finds only the two
definitions, Task 6's source-reading spec, a committed build artifact under
`frontend-web/.next-verify2/`, and two *comment* references inside frontend-admin). The live
Open Mic console is `frontend-admin/app/admin/open-mic/{page,new,[id]}`, and its create page
never uploads a file at all: `new/page.tsx:209-210` tells the operator "Paste a hosted URL —
file upload isn't available from this console (see code comment for why)", and both beat fields
still carry `placeholder="https://..."` (`:223`, `:228`). That reason is now stale: the proxy
that console sends everything through, `frontend-admin/app/api/web-proxy/[...path]/route.ts`,
was fixed to forward `await request.arrayBuffer()` verbatim with the caller's Content-Type
(`:91-99` — its own comment says "An ArrayBuffer forwards JSON and multipart alike, verbatim"),
so a binary upload through it works today.

The consequence is a product dead end, not a cosmetic one: step #02 promises artists a
downloadable mp3, spec decision J says prod "keeps zero editions until Spotlight publishes one
in the admin console" — and the console cannot publish an edition whose beat will play. Task 6
made the *correct* calls in files nothing loads. This task makes them reachable.

**Files:**
- Create: `frontend-admin/tests/admin/openmic/beat-upload-request.test.ts` (Step 1b — the only new file)
- Modify: `frontend-admin/tests/admin/openmic/beat-upload.test.tsx` (Steps 1 + 2 of this round: six cases)
- Modify: `frontend-admin/app/admin/open-mic/new/page.tsx` (`errors` beat gate, tone-aware `beatNote`,
  header comment `:9-13`, service import `:17`, state `:42`, required-field copy `:75`, handler above
  `submit()` at `:79`, Official Beat section `:207-231`, and the nine `id`/`htmlFor` pairs)
- Modify: `frontend-admin/src/features/openmic/beat-url.ts` (header comment only)
- Untouched this round: `frontend-admin/src/services/openMicAdminService.ts` — Step 4's function is
  already correct; it gains a test rather than a change.

**Interfaces:**
- Consumes: Task 2's `POST /api/admin/open-mic/beats` — reached as `${webProxyBase()}/api/admin/open-mic/beats`, i.e. `/api/web-proxy/api/admin/open-mic/beats`; its `201 { success, beat: { previewUrl, downloadUrl } }`; frontend-web's session bearer, which the proxy attaches server-side from the HttpOnly `sb-admin-token` cookie (`web-proxy/route.ts:59-66`), so this app sends **no** Authorization header.
- Produces: `uploadOpenMicBeat(file, contestId?) => Promise<{ previewUrl: string; downloadUrl: string }>` and `beatUrlProblem(value) => 'legacy' | 'unplayable' | null`. Same stored shapes as Task 6: `download_url = /api/open-mic/beats/<key>?download=1`.

**Deliberately out of scope, and why:** re-attaching a beat to an *existing* edition. The console's Edit Contest tab (`[id]/page.tsx:263`) edits metadata only — `EditFormState` (`:128`) and the PATCH body (`:153-171`) carry no beat at all, and `frontend-web/app/api/admin/open-mic/contests/[id]/route.ts` has no `beat` branch to send one to. That is a second, larger piece of work (a beat-aware PATCH), not a wiring fix; the legacy-repair path spec F describes therefore has no console UI yet. Report it; do not build it here.

**State at the start of this round.** Steps 1-5 landed once already (`e839ff50b`): the vocabulary file,
`uploadOpenMicBeat`, the picker and the two warnings all exist and behave as described. This round is
the review's four findings on top of that commit — the submit path still files an unplayable URL
(I-1), nothing guards the request shape (I-2), the mirror comment over-claims what pins it (I-3), and
the success note renders in the error tone (I-4). Where a step below says "create", the file is new in
this round; where it says "edit", it is already on disk.

- [ ] **Step 1: Write the failing behavioural test**

`frontend-admin/tests/admin/openmic/beat-upload.test.tsx` exists from the first pass with four cases;
this round takes it to six and rewrites two of the originals. Unlike frontend-web, this app
runs vitest in jsdom with `@testing-library/react` (`frontend-admin/vitest.config.ts`, and the
precedent at `tests/admin/crypto/reconciliation.test.tsx`), so the guard here can *exercise* the
form instead of reading its source — which is what Task 6's review asked for and this app can
afford. Replace its contents with:

```tsx
// The Open Mic create form used to offer only "paste a hosted URL", and the public
// beat reader allowlists /api/open-mic/beats/ — so every URL an operator could file
// here was one artists could not open. This guards the console that admins actually
// use: picking an mp3 uploads it through the web proxy and files the paths the
// server returns; a pasted URL that cannot play says so.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const uploadOpenMicBeat = vi.fn();
const createOpenMicContest = vi.fn();
vi.mock('@/services/openMicAdminService', () => ({
  uploadOpenMicBeat: (...a: unknown[]) => uploadOpenMicBeat(...a),
  createOpenMicContest: (...a: unknown[]) => createOpenMicContest(...a),
}));

// Vite does not resolve a Next route *directory*, so the page must be imported by
// file: `/page` is the module Next itself loads for `/admin/open-mic/new`. (The
// sibling precedent at tests/admin/crypto/reconciliation.test.tsx gets away with
// a bare directory only because a same-named file exists there.)
import NewOpenMicContestPage from '../../../app/admin/open-mic/new/page';

// The page calls useRouter() on render and vitest has no mounted Next app router,
// so every case dies on "invariant expected app router to be mounted" before it
// reaches the beat fields without this shim. Same mock this app already uses at
// src/components/guards/AdminRouteGuard.test.tsx:16; `push` is recorded so a later
// case can assert the post-create redirect.
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// A real reader path: base64url of `openmic-beats/unassigned/a.mp3`, exactly what
// beatObjectKey() + encodeBeatFileKey() produce. An invented key would let this
// guard pass against a URL the server can never return.
const READER = '/api/open-mic/beats/b3Blbm1pYy1iZWF0cy91bmFzc2lnbmVkL2EubXAz';

beforeEach(() => {
  uploadOpenMicBeat.mockReset();
  createOpenMicContest.mockReset();
});
afterEach(() => cleanup());

function downloadField(): HTMLInputElement {
  return screen.getByLabelText(/Beat file URL \(Download\)/i) as HTMLInputElement;
}

function set(container: HTMLElement, id: string, value: string) {
  const el = container.querySelector(`#${id}`) as
    | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!el) throw new Error(`no field with id "${id}" — Step 5 gives every required input one`);
  fireEvent.change(el, { target: { value } });
}

/**
 * `errors` (page.tsx:66-79) gates title, slug, description, month, year, the two
 * weights, state, city, venue name and beat title. A submit-path case must satisfy
 * all of them except the beat, or it proves nothing: `createOpenMicContest` would go
 * uncalled for an unrelated empty field and the blocked case would pass for the wrong
 * reason. The weights default to 30/70 (`:52`) and already sum to 100. Fields are
 * addressed by `id`, not by label, because /Month/i matches both "Month*" and
 * "Repeat Months" once the labels gain `htmlFor`.
 */
function fillRequiredExceptBeat(container: HTMLElement) {
  set(container, 'open-mic-title', 'November Open Mic');
  set(container, 'open-mic-slug', 'november-open-mic');
  set(container, 'open-mic-description', 'Monthly Open Mic edition.');
  set(container, 'open-mic-month', '11');
  set(container, 'open-mic-year', '2026');
  set(container, 'open-mic-beat-title', 'Spotlight Beat');
  set(container, 'open-mic-venue-name', 'The Bridge');
  set(container, 'open-mic-state', 'Lagos');
  set(container, 'open-mic-city', 'Ikeja');
}

describe('Open Mic beat upload in the admin console', () => {
  it('uploads the picked mp3, files both reader paths and warns about neither', async () => {
    uploadOpenMicBeat.mockResolvedValue({ previewUrl: READER, downloadUrl: `${READER}?download=1` });
    const { container } = render(<NewOpenMicContestPage />);
    const file = new File([new Uint8Array([1, 2, 3])], 'beat.mp3', { type: 'audio/mp3' });
    fireEvent.change(screen.getByLabelText(/Upload beat file/i), { target: { files: [file] } });
    await waitFor(() => expect(uploadOpenMicBeat).toHaveBeenCalledTimes(1));
    expect(uploadOpenMicBeat.mock.calls[0][0]).toBe(file);
    await waitFor(() => expect(downloadField().value).toBe(`${READER}?download=1`));
    expect(screen.getByLabelText(/Beat preview URL/i)).toHaveValue(READER);
    // An uploaded beat must read as *good*: nothing amber, and the confirmation must
    // not arrive in the error tone (review I-4 — the task's one user-visible success
    // rendered in #ea5455). These two absences are also the only assertions that pin
    // BEAT_READER_BASE in the console's mirror (review I-3): if that literal drifts
    // from the reader's, a real path stops matching the allowlist and they fail.
    expect(screen.queryByText(/Upload the mp3 instead/i)).toBeNull();
    expect(screen.queryByText(/before the public-beat fix/i)).toBeNull();
    expect(await screen.findByRole('status')).toHaveTextContent(/artists can now play and download/i);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces the server error in the alert tone, not as silence', async () => {
    // Wording copied from the real route: a hand-declared Content-Type is what
    // breaks the boundary, and this is the answer it earns (415, not 400).
    uploadOpenMicBeat.mockRejectedValue(new Error('Beat upload failed: 415 — Expected multipart/form-data'));
    render(<NewOpenMicContestPage />);
    fireEvent.change(screen.getByLabelText(/Upload beat file/i), {
      target: { files: [new File([new Uint8Array([1])], 'beat.mp3', { type: 'audio/mp3' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/415 — Expected multipart\/form-data/);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('warns about a pasted URL an artist cannot open', async () => {
    render(<NewOpenMicContestPage />);
    fireEvent.change(downloadField(), { target: { value: 'https://cdn.example.com/beat.mp3' } });
    expect(await screen.findByText(/Upload the mp3 instead/i)).toBeInTheDocument();
  });

  it('names a pre-fix registration URL as legacy, not as a URL', async () => {
    render(<NewOpenMicContestPage />);
    fireEvent.change(downloadField(), { target: { value: '/api/registration/uploads/abc' } });
    expect(await screen.findByText(/before the public-beat fix/i)).toBeInTheDocument();
  });

  it('refuses to publish a beat URL the reader cannot serve', async () => {
    // Review I-1 / spec decision J: an edition published from this console must carry
    // a beat an artist can open. An amber line the operator can read past is not that
    // guarantee, so the pasted off-site URL has to stop the POST — and say why in the
    // field error, which is the copy only a blocked submit produces.
    const { container } = render(<NewOpenMicContestPage />);
    fireEvent.change(downloadField(), { target: { value: 'https://cdn.example.com/beat.mp3' } });
    fillRequiredExceptBeat(container);
    fireEvent.click(screen.getByRole('button', { name: /Create Monthly Contest/i }));
    expect(await screen.findByText(/cannot play that address/i)).toBeInTheDocument();
    expect(createOpenMicContest).not.toHaveBeenCalled();
  });

  it('publishes the reader path when the beat came from the picker', async () => {
    // The positive half of the pair: with every required field valid and the beat
    // uploaded, blocking would be a dead affordance instead of a guard.
    uploadOpenMicBeat.mockResolvedValue({ previewUrl: READER, downloadUrl: `${READER}?download=1` });
    createOpenMicContest.mockResolvedValue({ success: true });
    const { container } = render(<NewOpenMicContestPage />);
    fireEvent.change(screen.getByLabelText(/Upload beat file/i), {
      target: { files: [new File([new Uint8Array([1])], 'beat.mp3', { type: 'audio/mp3' })] },
    });
    await waitFor(() => expect(downloadField().value).toBe(`${READER}?download=1`));
    fillRequiredExceptBeat(container);
    fireEvent.click(screen.getByRole('button', { name: /Create Monthly Contest/i }));
    await waitFor(() => expect(createOpenMicContest).toHaveBeenCalledTimes(1));
    const sent = createOpenMicContest.mock.calls[0][0] as { beat: { downloadUrl: string; previewUrl: string } };
    expect(sent.beat.downloadUrl).toBe(`${READER}?download=1`);
    expect(sent.beat.previewUrl).toBe(READER);
  });
});
```

`createOpenMicContest` resolving `{ success: true }` schedules `window.setTimeout(() => router.push(…), 700)`
(`page.tsx:134`). Keep real timers — the assertions finish first, so the timer lands after the test. If it
surfaces a stray `act()` warning, that is the finding to report, not to silence.

- [ ] **Step 1b: Pin the multipart request shape on its own**

Step 1 mocks the service away, so **nothing in that file can see how the request is built** — and the
one thing that makes the upload work at all is that nothing is added to it. The route answers
`415 Expected multipart/form-data` (`frontend-web/app/api/admin/open-mic/beats/route.ts:33`) the moment a
caller declares its own `Content-Type`, and CI would not notice: the frontend-admin lane in
`.github/workflows/ci-optimized.yml:52` is `npm run type-check || true`, so it swallows even a type error.
Create `frontend-admin/tests/admin/openmic/beat-upload-request.test.ts` — a service-level test, real
`uploadOpenMicBeat`, `fetch` stubbed:

```ts
// The upload works because of what the request does NOT carry: no Content-Type (the browser has to
// add the multipart boundary itself) and no Authorization (the web-proxy attaches the bearer from
// the HttpOnly cookie). Both are one-token refactors away from being "tidied up", and neither would
// fail Step 1's test, type-check, or CI. This file is the only guard, so it must not mock the module
// under test.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadOpenMicBeat } from '@/services/openMicAdminService';

type Call = { url: string; init: RequestInit | undefined };

function stubFetch(body: unknown, ok = true, status = 200) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return { ok, status, json: async () => body } as unknown as Response;
  }));
  return calls;
}

const mp3 = () => new File([new Uint8Array([1, 2, 3])], 'beat.mp3', { type: 'audio/mp3' });
const OK = { success: true, beat: { previewUrl: '/api/open-mic/beats/k', downloadUrl: '/api/open-mic/beats/k?download=1' } };

afterEach(() => vi.unstubAllGlobals());

describe('uploadOpenMicBeat request shape', () => {
  it('posts the mp3 as multipart to the beat route through the web proxy', async () => {
    const calls = stubFetch(OK);
    await uploadOpenMicBeat(mp3());
    expect(calls).toHaveLength(1);
    // Origin-agnostic: jsdom's location is not the deployment origin.
    expect(calls[0].url).toMatch(/\/api\/web-proxy\/api\/admin\/open-mic\/beats$/);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect((calls[0].init?.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('declares no headers, so the boundary and the proxy bearer both survive', async () => {
    const calls = stubFetch(OK);
    await uploadOpenMicBeat(mp3());
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
    for (const name of ['Content-Type', 'content-type', 'Authorization', 'authorization']) {
      expect(headers, name).not.toHaveProperty(name);
    }
  });

  it('scopes the object key to a contest only when one is given', async () => {
    const bare = stubFetch(OK);
    await uploadOpenMicBeat(mp3());
    expect(bare[0].url).not.toContain('contestId');
    const scoped = stubFetch(OK);
    await uploadOpenMicBeat(mp3(), 'c/1');
    expect(scoped[0].url).toContain('contestId=c%2F1');
  });

  it('returns the two reader paths and refuses to hand back an empty beat', async () => {
    stubFetch(OK);
    await expect(uploadOpenMicBeat(mp3())).resolves.toEqual({
      previewUrl: '/api/open-mic/beats/k',
      downloadUrl: '/api/open-mic/beats/k?download=1',
    });

    stubFetch({ success: false, error: 'Beat must be an MP3 file' }, false, 400);
    await expect(uploadOpenMicBeat(mp3())).rejects.toThrow(/Beat must be an MP3 file/);

    // A success envelope with no URL is the shape that used to file an empty beat.
    stubFetch({ success: true, beat: { previewUrl: '/api/open-mic/beats/k' } });
    await expect(uploadOpenMicBeat(mp3())).rejects.toThrow(/no beat URL/);
  });
});
```

The last case is the reason the service keeps `if (!downloadUrl) throw`: without it a 200 carrying
`{ success: true }` and no URL would file an empty beat and the form would say "Beat uploaded".

- [ ] **Step 2: Run both files and read which half is red**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-admin && npx vitest run tests/admin/openmic`

This is a **strengthening round on code that already landed** (`e839ff50b`), so the two files fail
differently and both outcomes are expected:

- `beat-upload.test.tsx` — cases 5 and 6 and the new assertions inside cases 1 and 2 must **FAIL** (no
  submit-time block, no `role`/`status`, no `id`s yet). Cases 3 and 4 stay green — they were proven when
  the picker shipped. A green run for 5/6 here would mean the assertion is not biting.
- `beat-upload-request.test.ts` — all four cases **PASS immediately**, because they describe the service
  as shipped. That is a regression guard, not TDD red, and it is worth nothing until each case is
  mutation-proved. Per the standing rule for strengthening rounds: after they pass, introduce the
  regression each exists for, watch that one case fail, revert, and report each mutation with the case
  it killed. For this file: add `headers: { 'Content-Type': 'application/json' }` to the `fetch` init
  (`openMicAdminService.ts:370-373`) → case 2 must fail; build `qs` unconditionally → case 3 must fail;
  delete `if (!downloadUrl) throw` (`:381`) → case 4 must fail.

Also prove the page-side additions bite, since the same rule applies: make `uploadBeat` pass a
`'danger'` tone to the success note → case 1 must fail; drop the `beatUrlProblem` entry from `errors`
(Step 5) → case 5 must fail; change `BEAT_READER_BASE` in `beat-url.ts:13` to any other literal →
case 1 must fail (that is the assertion that makes the mirror comment true).

- [ ] **Step 3: Add the beat-URL vocabulary**

`frontend-admin/src/features/openmic/beat-url.ts` — created by the first pass, so **edit** it, do not
recreate it. Only its header comment changes in this round; the constants are copied verbatim from
`frontend-web/src/features/openmic/beat-storage.ts:13,20` and `publicBeatUrl` (`:59-63`) /
`isLegacyBeatUrl` (`:72-74`) — the two apps are separately deployed Next projects with no shared
package, so a mirror is the only option. The comment must name the source of truth and the test that
pins each copy, so the next reader knows which file to change first and what breaks if they diverge:

```ts
/**
 * Can an artist open this beat URL? The authoritative vocabulary lives in
 * frontend-web — src/features/openmic/beat-storage.ts (BEAT_READER_BASE,
 * LEGACY_UPLOAD_PREFIX, publicBeatUrl, isLegacyBeatUrl) — and the reader that
 * enforces it is app/api/open-mic/beats/[fileKey]/route.ts.
 *
 * Mirrored here, not imported: frontend-admin and frontend-web are separately
 * deployed Next apps — frontend-web's `@/*` maps inside itself and there is no
 * `shared/` directory at the repo root, so neither app can reach the other's
 * module. If the reader's prefix ever changes, change it in BOTH files. Each
 * copy is pinned by a failing test: frontend-web's by the reader tests in
 * tests/unit/openmic and tests/unit/media, this copy by beat-upload.test.tsx
 * case 1, which asserts that a real reader path warns nothing — drift here
 * makes that path look unplayable and the case dies.
 */
export const BEAT_READER_BASE = '/api/open-mic/beats';
export const LEGACY_UPLOAD_PREFIX = '/api/registration/uploads/';

export type BeatUrlProblem = 'legacy' | 'unplayable';

/** null when the value is empty or a path this site's reader serves. */
export function beatUrlProblem(stored: string | null | undefined): BeatUrlProblem | null {
  const value = String(stored || '').trim();
  if (!value) return null;
  if (value.startsWith(LEGACY_UPLOAD_PREFIX)) return 'legacy';
  return value.startsWith(`${BEAT_READER_BASE}/`) ? null : 'unplayable';
}
```

- [ ] **Step 4: Add the upload call to the service**

In `frontend-admin/src/services/openMicAdminService.ts`, append after `createOpenMicContest`
(ends `:350`) — the first pass already did this, so **Step 4 needs no code change in this round**; it
is here because Step 1b is the test that was missing from it. No `Content-Type` anywhere: setting one
would override the FormData boundary and the route answers `415 Expected multipart/form-data`
(`frontend-web/app/api/admin/open-mic/beats/route.ts:33` — not the 400 this plan first claimed).
No Authorization either — `authHeaders()` (`:167-170`) is empty on
purpose, the proxy attaches the bearer from the HttpOnly cookie (`env.ts`, `adminAuthHeaders`'
comment). `contestId` is optional because a new edition does not exist yet, and Task 2's route
accepts that by filing under `openmic-beats/unassigned/`:

```ts
/**
 * Upload the official beat mp3. This is the one write the Path-A port skipped:
 * the note above createOpenMicContest claimed the web proxy could not carry a
 * binary body, and app/api/web-proxy/[...path]/route.ts has since been fixed to
 * forward request.arrayBuffer() verbatim with the caller's Content-Type, so the
 * multipart boundary survives and the file lands intact.
 *
 * Returns the two root-relative reader paths Task 1/2 defined; the caller files
 * them as the contest's beat URLs. Throws with the server's own wording so the
 * form can show why an upload was refused.
 */
export async function uploadOpenMicBeat(
  file: File,
  contestId?: string,
): Promise<{ previewUrl: string; downloadUrl: string }> {
  const body = new FormData();
  body.append('file', file);
  const qs = contestId ? `?contestId=${encodeURIComponent(contestId)}` : '';
  const res = await fetch(`${webBase()}/api/admin/open-mic/beats${qs}`, {
    method: 'POST',
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean; error?: string; beat?: { previewUrl?: string; downloadUrl?: string };
  };
  if (res.status === 401) throw new Error('Beat upload failed: 401 — sign in again.');
  if (res.status === 403) throw new Error('Beat upload failed: 403 — this account cannot edit Open Mic contests.');
  if (!res.ok || !json.success) throw new Error(`Beat upload failed: ${json.error || res.status}`);
  const downloadUrl = String(json.beat?.downloadUrl || '');
  if (!downloadUrl) throw new Error('Beat upload failed: the server returned no beat URL.');
  return { previewUrl: String(json.beat?.previewUrl || downloadUrl), downloadUrl };
}
```

Then correct the comment it contradicts. Replace `:331-333` — "NOT ported: the 'upload a beat
file' control. This form keeps the 'paste a beat URL' path (already the primary path in the
original UI) and drops the file-picker; paste a pre-hosted URL instead." — with two sentences
that say what is now true, and keep the surrounding paragraph intact:

```ts
 * Ported here in full except the beat file-picker, which `uploadOpenMicBeat`
 * below now provides: a pasted URL is not a playable value, because the public
 * beat reader only serves /api/open-mic/beats/… paths.
```

- [ ] **Step 5: Wire the form**

In `frontend-admin/app/admin/open-mic/new/page.tsx`:

Replace the header comment at `:9-13` (the "One deliberate omission … corrupts a binary
multipart upload … Only the 'paste a beat URL' path is kept here" paragraph) with:

```ts
 * Same fields, same POST /api/admin/open-mic/contests route, reached through the
 * web proxy. The beat arrives as an mp3 upload through /api/web-proxy — the
 * paste-a-URL-only path was removed because the public beat reader serves only
 * /api/open-mic/beats/… paths, so a pasted third-party URL looked fillable and
 * played for nobody.
```

Add `uploadOpenMicBeat` to the `:17` import, and beside it:

```ts
import { beatUrlProblem } from '@/features/openmic/beat-url';
```

Add state after `:42` (`const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});`):

```tsx
  const [beatBusy, setBeatBusy] = useState(false);
  // The note carries its own tone: this line says both "uploaded" and "refused", and
  // rendering one of them in the other's colour made the task's only success look
  // like a failure (review I-4). `tone` drives colour *and* ARIA role, so the
  // distinction survives without a hex value in the test.
  const [beatNote, setBeatNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
```

Add the handler immediately above `submit()` (`:79`):

```tsx
  async function uploadBeat(file: File) {
    setBeatBusy(true);
    setBeatNote(null);
    try {
      const beat = await uploadOpenMicBeat(file);
      setField('beatDownloadUrl', beat.downloadUrl);
      setField('beatPreviewUrl', beat.previewUrl);
      setBeatNote({ text: 'Beat uploaded — artists can now play and download it.', tone: 'ok' });
    } catch (e) {
      setBeatNote({ text: e instanceof Error ? e.message : String(e), tone: 'bad' });
    } finally {
      setBeatBusy(false);
    }
  }
```

Narrow the required-field copy at `:75` so it names the action rather than a URL, and **block the
submit on playability** — an amber line is advisory, and spec decision J is a guarantee (review I-1):

```tsx
    if (!form.beatDownloadUrl.trim()) e.beatDownloadUrl = 'Upload the official beat mp3.';
    else if (beatUrlProblem(form.beatDownloadUrl) !== null) {
      e.beatDownloadUrl = 'Upload the beat mp3 — the programme page cannot play that address.';
    }
```

The two messages must stay distinguishable, because Step 1's case 5 asserts on the second one: the
live warning says "cannot **serve** that address", the blocking field error says "cannot **play** that
address". `beatUrlProblem` returns `null` for an empty value, so this adds no constraint the required
rule does not already impose — it only refuses the two values that are known to be broken.

Replace the intro paragraph at `:209-211` — "Paste a hosted URL — file upload isn't available
from this console (see code comment for why)." — with:

```tsx
            Upload the beat mp3. The programme page can only play and offer a file this site
            stores; a URL from another host will not open for an artist.
```

Insert a picker row directly before the download-URL field's `<div style={fieldWrap}>` (`:221`),
and rewrite the two URL fields (`:221-225` download, `:226-230` preview). Each of the three controls
gets an `id`, its `<label>` gets the matching `htmlFor`, and the `aria-label`s the first pass added are
**removed** — with both present, `getByLabelText` matches twice and the field's own text is the better
label anyway. A manual edit clears the note: a line explaining an upload must not stay on screen as the
explanation for a value the operator typed:

```tsx
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-beat-file">Upload Beat File (MP3)*</label>
            <Input
              id="open-mic-beat-file"
              type="file"
              accept=".mp3"
              disabled={beatBusy}
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) void uploadBeat(selected);
              }}
            />
            {beatBusy ? <p style={{ fontSize: 12, color: colors.muted, margin: '4px 0 0' }}>Uploading…</p> : null}
            {beatNote ? (
              <p
                role={beatNote.tone === 'ok' ? 'status' : 'alert'}
                style={{ fontSize: 12, color: beatNote.tone === 'ok' ? colors.success : colors.danger, margin: '4px 0 0' }}
              >
                {beatNote.text}
              </p>
            ) : null}
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-beat-download-url">Beat File URL (Download)*</label>
            <Input id="open-mic-beat-download-url" value={form.beatDownloadUrl} onChange={(e) => { setField('beatDownloadUrl', e.target.value); setBeatNote(null); }} placeholder="/api/open-mic/beats/…" style={{ width: '100%' }} />
            {fieldErrors.beatDownloadUrl && <p style={{ color: colors.danger, fontSize: 12, margin: '4px 0 0' }}>{fieldErrors.beatDownloadUrl}</p>}
            {beatUrlProblem(form.beatDownloadUrl) === 'legacy' ? (
              <p style={{ color: colors.warning, fontSize: 12, margin: '4px 0 0' }}>
                This beat was uploaded before the public-beat fix, so artists get an access error.
                Upload the mp3 instead of pasting a URL.
              </p>
            ) : beatUrlProblem(form.beatDownloadUrl) === 'unplayable' ? (
              <p style={{ color: colors.warning, fontSize: 12, margin: '4px 0 0' }}>
                The programme page cannot serve that address, so the beat will not play or download.
                Upload the mp3 instead of pasting a URL.
              </p>
            ) : null}
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle} htmlFor="open-mic-beat-preview-url">Beat Preview URL (Optional)</label>
            <Input id="open-mic-beat-preview-url" value={form.beatPreviewUrl} onChange={(e) => { setField('beatPreviewUrl', e.target.value); setBeatNote(null); }} placeholder="/api/open-mic/beats/…" style={{ width: '100%' }} />
            {beatUrlProblem(form.beatPreviewUrl) === 'unplayable' ? (
              <p style={{ color: colors.warning, fontSize: 12, margin: '4px 0 0' }}>
                The player ignores a preview it cannot serve. Upload the mp3, or leave this empty to
                play the download file.
              </p>
            ) : null}
          </div>
```

Then give the nine fields below the same `id`/`htmlFor` pair. None of them is decorative:
Step 1's cases 5 and 6 cannot reach the submit path without filling every one — `errors` (`:66-80`)
blocks the POST on all nine (`:68-77`; State, City and Finale Venue Name are validated at `:74-76`
even though only the first six labels carry a `*`) — and today a `<label>` sits next to its input with
no association at all, so a screen reader announces an unlabelled control.
The `id` on each control matches the label text below — add `htmlFor="<id>"` to that `<label>` and
`id="<id>"` to the control beside it (`Input`, `textarea` at `:163`, or `select` at `:314`):

| Line | Label | id |
|---|---|---|
| `:152` | Contest Title* | `open-mic-title` |
| `:157` | Contest Slug* | `open-mic-slug` |
| `:162` | Description* | `open-mic-description` |
| `:173` | Month* | `open-mic-month` |
| `:178` | Year* | `open-mic-year` |
| `:232` | Official Beat Title* | `open-mic-beat-title` |
| `:293` | Finale Venue Name | `open-mic-venue-name` |
| `:313` | State | `open-mic-state` |
| `:321` | City | `open-mic-city` |

Leave every other control (Season, Status, fees, weights, Venue Type, Address, the checkboxes) alone —
they are not in `errors` and adding ids they do not need is churn.

- [ ] **Step 6: Run the tests and this app's gates**

Run, in order, each separately so a failure names itself, and redirect to a file before checking the
exit code (`cmd | tail; echo $?` reports `tail`'s status, not the command's):

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-admin && npx vitest run tests/admin/openmic
cd /Users/paymax/Documents/spotlight/main/frontend-admin && npm test
cd /Users/paymax/Documents/spotlight/main/frontend-admin && npm run type-check
```
Expected: the two files give **6 passed** (`beat-upload.test.tsx`) and **4 passed**
(`beat-upload-request.test.ts`). The whole suite is **already red before this task** — the controller's
own run on `ef2b8b453` measured `Test Files 8 failed | 55 passed (63)` / `Tests 9 failed | 530 passed
(539)`, and those nine failures are in analytics, restaurant onboarding, merchant onboarding, the
sidebar, the dashboard, `adminSimulatedWrites` and `analyticsService`, none of which this task touches.
**Compare failing test names, not counts** — the counts move with other sessions' uncommitted work in
this shared worktree. A new openmic failure is a regression; anything else is not yours.

Expect `Test timed out in 5000ms` on any case in `beat-upload.test.tsx` if the `}, 20_000)` budgets are
missing: every case renders the whole contest form (~0.4 s per render, 2 s per case alone) and the
parallel suite pushes that past the 5 s default — in a measured run **10 of the 13** app-wide failures
were exactly this, across the sidebar, dashboard, crypto and restaurant specs. Keep the budget, and
keep case 1 to a single `waitFor`: the download field can only hold the reader path after
`uploadOpenMicBeat` resolves, and its `setField`/`setBeatNote` commits land together, so the rest of
the case is synchronous. `src/components/layouts/AdminSidebar.test.tsx:58` is the in-app precedent for
the timeout, not something to invent.

`npm run lint` is `next lint`, which the installed Next 16.4.3 removed, and `npm run check:mock-flags`
exits 1 for 42 flags this task did not add. Neither is a gate you can pass or should chase; say so in
the report rather than reporting them green. `npm run type-check` excludes `**/*.test.tsx`
(`tsconfig.json:41-45`), so it never sees either test file — do not claim it typed them; vitest's own
transform is what compiles them.

Then prove the browser path, because this task's whole claim is that a real upload survives the
proxy. With frontend-web on :3000 and frontend-admin on :3001, both signed in as admin, open
`/admin/open-mic/new`, choose a real mp3 and confirm: both URL fields fill with
`/api/open-mic/beats/…`, no amber warning shows, the confirmation line is **green**, and
`curl -o /dev/null -w '%{http_code}' <the absolute URL>` on the value answers 200. If you cannot sign
in — the admin password is the operator's own and must not be guessed or reset — **stop and say so**;
report the unauthenticated probe result instead of implying the upload ran. If the upload 415s, the
proxy is not carrying the body after all — that is the finding, so report it rather than working
around it.

- [ ] **Step 7: Commit**

```bash
git -C /Users/paymax/Documents/spotlight/main add frontend-admin/src/features/openmic/beat-url.ts \
  frontend-admin/app/admin/open-mic/new/page.tsx \
  frontend-admin/tests/admin/openmic/beat-upload.test.tsx \
  frontend-admin/tests/admin/openmic/beat-upload-request.test.ts \
  docs/superpowers/plans/2026-11-10-open-mic-competition-steps.md && \
git -C /Users/paymax/Documents/spotlight/main commit -m "fix(admin): make the Open Mic beat guard stop an unplayable publish

The console gained a picker but kept a Publish button that filed whatever was typed
into the URL field, so an operator who read past one amber line still published an
edition whose beat no artist could open. The submit now refuses it, the confirmation
says so in its own colour, and the multipart request shape the upload depends on is
pinned by a test that does not mock the service."
```

Stage exactly those paths, `add` and `commit` in one invocation with an explicit pathspec on the
commit too, and never `git add -A` — other sessions commit in this worktree. Do not stage
`frontend-admin/app/api/web-proxy/[...path]/route.ts`, its two untracked test files,
`frontend-admin/.env.example` or `app/admin/academy/film/page.tsx`: another session owns those right
now.

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
// `insert`, not `upsert({onConflict:'competition_id'})`: the foundation migration
// gives competition_beats only plain indexes on competition_id
// (20260410190000_one_beat_one_verse_foundation.sql:111-115), no unique constraint,
// so an id-conflict upsert is rejected outright. The shipped writer keys its upsert
// on the PK instead (persistence.ts:848-859) — follow it if a row already exists.
const {error}=await sb.from('competition_beats').insert({
  competition_id:'<contestId>',title:'Street Light (dev beat)',genre:'Hip Hop',
  producer_credit:'DJ Wole (dev)',preview_url:'<previewUrl from step 3>',
  download_url:'<downloadUrl from step 3>',rules_text:'Original bars only. No clear-text sample packs.',
  requires_enrollment:false,is_active:true,
});
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
 *
 * Two limits of this file, so a red run is read correctly. It is a local gate
 * only — no CI workflow runs Playwright — and it runs against the fixture with
 * both admin switches ON, so the switch-off branches of design H2 are gated by
 * Task 5's unit tests (`showLeaderboard` / `showVoteCounts`), not here. And
 * Task 7's fixture submission window closes 2026-11-24: after that this spec
 * goes red on the calendar, not the code, so re-seed the fixture first.
 */
import { expect, test } from '@playwright/test';

const PAGE = '/service-details/open-mic-competition';
const SLUG = 'open-mic-dev';

async function openStep(page: import('@playwright/test').Page, step: 1 | 2 | 3 | 4 | 5) {
  await page.goto(`${PAGE}#step-${step}`);
  const panel = page.locator(`#step-${step}`);
  await expect(panel).toBeVisible();
  // Design F keeps the hash-to-accordion behaviour, so the page opens this step
  // itself once hydrated — wait for that rather than clicking. The earlier
  // "click only if it is not already open" helper is what failed: it read the
  // flag and then clicked, and hydration landing in the gap between those two
  // round trips made the click close what the feature had just opened, which is
  // why #step-1 collapsed alongside #step-3 and #step-5. Polling also gates the
  // behaviour itself — a hash handler that never opens anything now fails here
  // instead of being quietly clicked open by the test.
  await expect
    .poll(() => panel.evaluate((el) => (el as HTMLDetailsElement).open), {
      message: `#step-${step} must open from its own hash`,
    })
    .toBe(true);
  if (step !== 1) {
    // The other side of the same contract: SSR ships #step-1 open, so only the
    // hash handler opening this panel can close it. Asserting it pins the
    // exclusive accordion itself — a page that lost the `name` grouping would
    // still pass the check above.
    await expect
      .poll(() => page.locator('#step-1').evaluate((el) => (el as HTMLDetailsElement).open), {
        message: '#step-1 must close when the hash opens a later step',
      })
      .toBe(false);
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
  const rows = panel.locator('li[data-rank]');
  await expect(rows).toHaveCount(5);
  // Task 7's fixture board in rank order, pinned row by row. The vote count is
  // the requirement, not decoration — a board that names who is winning without
  // their votes has not answered step #05 — and pinning every row rather than
  // the two ends is what catches a board that repeats or shifts a middle value.
  // The word boundaries stop a padded 4120 from passing for 412. Each slug is
  // `slugifyArtist(stageName)`; every artist page answers 200 to an anonymous
  // reader and hosts the vote modal, so the row CTA lands where that one
  // artist's vote can actually be cast. Five links to one board would not be a
  // CTA "per each contestant" — design row #05, ruling 8-B.
  const standings = [
    { name: 'Adaeze Okonkwo', votes: /\b412\b/, slug: 'adaeze-okonkwo' },
    { name: 'Bello Miracle', votes: /\b388\b/, slug: 'bello-miracle' },
    { name: 'Tunde Signals', votes: /\b251\b/, slug: 'tunde-signals' },
    { name: 'K1ng$hoota', votes: /\b190\b/, slug: 'k1nghoota' },
    { name: 'Zabbymoney', votes: /\b96\b/, slug: 'zabbymoney' },
  ];
  await expect(rows.getByRole('link', { name: /^vote$/i })).toHaveCount(5);
  for (const [index, row] of standings.entries()) {
    const line = rows.nth(index);
    await expect(line).toContainText(row.name);
    await expect(line).toContainText(row.votes);
    await expect(line.getByRole('link', { name: /^vote$/i })).toHaveAttribute(
      'href',
      `/open-mic/${SLUG}/entry/${row.slug}`,
    );
  }
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
- Consumes: Task 5's `OpenMicEditionStepsData`, including that `data.board` is `null` when the board could not be read, `{rows: [], …}` when the edition has no entries yet, and otherwise already cut to five in the store's standing order — the four render branches at step #05 map those three facts plus "standings hidden" one-to-one, and no branch may print a number for a `null` board. `rank` is the store's composite standing (judges + votes), so nothing here may call it "most voted". Since Task 9b it also carries `registrationState`/`submissionState`/`votingState`, resolved by the server read against one instant: this component displays those and must never compute a window from the clock itself. Task 1's `publicBeatUrl` (already applied server-side — this component never re-derives availability); `createClient` from `@/lib/supabase/client` for the signed-in entry lookup; `slugifyArtist` from `@/src/features/openmic/workflow`; `GET /api/open-mic/submissions?contestId=<id>` (bearer, already filtered to `user.id`).
- Produces: `OpenMicEditionSteps({ data })`, a client component rendering `<section id="route">` with `#step-1…#step-5`. Task 10 renders it from the view.

- [ ] **Step 1: Write the styles for what today's CSS has no rule for**

Create `frontend-web/components/openmic/competition/edition-steps.module.css`. The page keeps its own `openMic-*` classes for layout; this module covers only the new bits (a `.module.css` is the idiom already used by `app/service-details/film-academy/*`, and it avoids touching `open-mic.css`, which another session has in flight):

```css
/* Live content inside the five step accordions. */
.stepState { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; margin: 14px 0; font-size: 14px; }
.stepState b { font-weight: 700; }
.windowOpen { color: #1f7a3d; }
.windowClosed { color: #8a3b12; }
.windowUnknown { color: #4d4a45; }

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
import type { OpenMicEditionStepsData, WindowState } from '@/src/features/openmic/active-edition';
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

// Every number and date here is server-rendered HTML, so the formatting locale
// cannot be the visitor's: a German browser renders `1500` as `1.500` against
// the server's `1,500` and React reports a text mismatch at hydration.
const LOCALE = 'en-GB';

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBC';

/** Which side of a window the clock is on is decided by the server read
 *  (Task 9b) — this component displays the answer and never computes it,
 *  because reading the clock in the body pre-renders one answer and hydrates
 *  another. */
function WindowLine({ label, start, end, state }: { label: string; start: string | null; end: string | null; state: WindowState }) {
  return (
    <p className={styles.stepState}>
      <b>{label}</b>
      <span>{shortDate(start)} → {shortDate(end)}</span>
      {/* `unknown` is unset dates, not a closed window — the rust colour would
          contradict the words next to it. */}
      <span className={state === 'open' ? styles.windowOpen : state === 'unknown' ? styles.windowUnknown : styles.windowClosed}>
        {state === 'open' ? '· open now' : state === 'not-started' ? '· opens later' : state === 'closed' ? '· closed' : '· dates to be confirmed'}
      </span>
    </p>
  );
}

/** The shape `/api/open-mic/submissions` answers with, as far as step 04 needs
 *  it. Every field optional: this is a network payload, and a server that stops
 *  naming one must not print `undefined` into an artist's own entry line. */
type OwnEntryRow = { status?: string; stageName?: string; songTitle?: string; voteCount?: number };

/** Step 04 is the only one the server cannot answer: whose entry it is depends
 *  on who is signed in. */
function OwnEntry({ contestId, contestSlug }: { contestId: string; contestSlug: string }) {
  const [entry, setEntry] = useState<{ stageName: string; songTitle: string; voteCount: number } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Inside the try: a throw here used to strand this step on "Checking
        // your entries…" forever, because `finally` was never reached.
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch(`/api/open-mic/submissions?contestId=${encodeURIComponent(contestId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = (await res.json().catch(() => null)) as { submissions?: OwnEntryRow[] } | null;
        const live = (payload?.submissions ?? []).find((row) =>
          ['published_for_voting', 'live_for_voting', 'finalist', 'winner'].includes(String(row.status))
        );
        if (active && live?.stageName) {
          setEntry({ stageName: live.stageName, songTitle: live.songTitle ?? '', voteCount: Number(live.voteCount || 0) });
        }
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
      <p className={styles.tally}>Your entry: <strong>{entry.stageName}</strong>{entry.songTitle ? ` — “${entry.songTitle}”` : ''} · {entry.voteCount.toLocaleString(LOCALE)} votes so far</p>
      <code className={styles.entryLink}>{url}</code>
      <div className="openMic-actions">
        <Link className="openMic-button openMic-buttonOutline" href={path}>Open your entry page <span aria-hidden="true">→</span></Link>
      </div>
    </>
  );
}

export default function OpenMicEditionSteps({ data }: { data: OpenMicEditionStepsData | null }) {
  const [activeStage, setActiveStage] = useState<string | null>('step-1');

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
                      <WindowLine label="Registration" start={data.registrationStartAt} end={data.registrationEndAt} state={data.registrationState} />
                      <p className={styles.tally}>
                        {data.entryFeeRequired
                          ? `Registration fee: ₦${data.registrationFeeNgn.toLocaleString(LOCALE)}.`
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
                        /* Design's error-handling bullet: in this arm step 02's
                           CTA is the apply page, never a download. */
                        <>
                          <p className={styles.note}>The file unlocks once your entry fee is paid — register first, then download.</p>
                          {data ? (
                            <div className="openMic-actions">
                              <Link className="openMic-button openMic-buttonOutline" href={`/open-mic/${data.slug}/apply`}>Register to unlock the beat <span aria-hidden="true">→</span></Link>
                            </div>
                          ) : null}
                        </>
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
                      <WindowLine label="Submission window" start={data.submissionStartAt} end={data.submissionEndAt} state={data.submissionState} />
                      <p className={styles.tally}>Format: MP3 up to {MAX_MP3_MB}MB, recorded over this edition’s beat.</p>
                      <div className="openMic-actions">
                        <Link
                          className="openMic-button openMic-buttonPrimary"
                          href={data.submissionState === 'open' ? `/open-mic/${data.slug}/enter` : `/open-mic/${data.slug}/entries`}
                        >
                          {data.submissionState === 'open' ? 'Submit your song' : 'See the live entries'} <span aria-hidden="true">→</span>
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
                      <WindowLine label="Voting window" start={data.votingStartAt} end={data.votingEndAt} state={data.votingState} />
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
                            {board.totalVotes !== null ? ` · ${board.totalVotes.toLocaleString(LOCALE)} votes counted` : ''}
                          </p>
                          {/* Keyed on rank, not artistSlug alone: the slug is a
                              slug of a non-unique stage name (design: `K1ng$hoota`
                              → `k1nghoota`) and this projection carries no row id. */}
                          <ol className={styles.board}>
                            {board.rows.map((row) => (
                              /* Cells are separated with a space, not only by the grid:
                                 JSX drops the whitespace between adjacent elements, so
                                 without it the row's text reads "…Street Light412 votes"
                                 and no word boundary exists around the count — a copy of
                                 the board that only the stylesheet can parse. */
                              <li key={`${row.rank}-${row.artistSlug}`} data-rank={row.rank}>
                                <span className={styles.rank}>{row.rank}</span>{' '}
                                <span className={styles.who}>
                                  <strong>{row.stageName}</strong>{' '}
                                  <span>{row.songTitle}</span>
                                </span>{' '}
                                <span className={styles.votes}>{row.voteCount !== null ? `${row.voteCount.toLocaleString(LOCALE)} votes` : '—'}</span>{' '}
                                <span className={styles.link}>
                                  <Link href={`/open-mic/${data.slug}/entry/${row.artistSlug}`}>Vote</Link>
                                </span>
                              </li>
                            ))}
                          </ol>
                          <div className="openMic-actions">
                            <Link className="openMic-button openMic-buttonPrimary" href={`/open-mic/${data.slug}/entries`}>Vote now <span aria-hidden="true">→</span></Link>
                          </div>
                        </>
                      )}
                      {/* Gated on the same switch as the board itself: a hand-off
                          to the full standings would refute the "standings private"
                          note two lines above it. */}
                      {data.showLeaderboard && (
                        <div className="openMic-actions">
                          <Link className="openMic-button openMic-buttonOutline" href={`/open-mic/${data.slug}/entries`}>Full leaderboard <span aria-hidden="true">→</span></Link>
                        </div>
                      )}
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

### Task 9b: Resolve the window states on the server

Task 9 review finding M-1, ruled out of Task 9's two-file boundary and into its
own change. The component computed `registration`/`submission`/`voting` from
`const now = Date.now()` **during render**, which is the one thing a server
pre-rendered page may not do: the HTML the server writes is produced at request
time and the first client render at hydration time, and any clock crossing
between those two — a submission window that closes mid-request, or a page
rendered just before midnight — makes React's tree disagree with the DOM.
React 19 patches the text, so today the symptom is a console warning rather
than a broken page; the state of step #03's CTA (`/enter` versus `/entries`) is
the part that would actually be wrong, and `persistence.ts:1251-1258` refuses a
submission outside the window, so an artist clicking the stale-open link is
honestly turned away. Fixed anyway, and fixed here: the same class of bug is
what Task 10's browser pass would surface as a hydration error, and the repair
belongs to the read, not the render.

**Files:**
- Modify: `frontend-web/src/features/openmic/active-edition.ts` (type + builder)
- Modify: `frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx` (consume, do not compute)
- Test: `frontend-web/tests/unit/openmic/edition-steps-data.spec.ts`

**Interfaces:**
- Consumes: Task 5's `at()` normalisation and `buildOpenMicEditionStepsData(contest, board)` signature — unchanged.
- Produces: `WindowState` and `windowState(start, end, now)` exported from `active-edition.ts`, and three new `WindowState` fields on `OpenMicEditionStepsData`: `registrationState`, `submissionState`, `votingState`. Task 9's `WindowLine` keeps its `state` prop but takes the type from the features module; Task 10's mount is untouched.

- [ ] **Step 1: Write the failing builder tests**

Append to `frontend-web/tests/unit/openmic/edition-steps-data.spec.ts`, and add
`afterEach` to the existing `vitest` import at the top of the file:

```ts
describe('the three window states, resolved by the read', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // START/END span November 2026. The clock is pinned rather than trusted: a
  // test that read the real one would go red on 1 December and teach nobody
  // anything about this code.
  it('is open while now sits inside the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
    const data = buildOpenMicEditionStepsData(contest(), []);
    expect(data.registrationState).toBe('open');
    expect(data.submissionState).toBe('open');
    expect(data.votingState).toBe('open');
  });

  it('is not-started before the window opens and closed after it ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
    expect(buildOpenMicEditionStepsData(contest(), []).registrationState).toBe('not-started');
    vi.setSystemTime(new Date('2026-12-05T00:00:00.000Z'));
    expect(buildOpenMicEditionStepsData(contest(), []).submissionState).toBe('closed');
  });

  it('is unknown when neither end of the window is set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T00:00:00.000Z'));
    const data = buildOpenMicEditionStepsData(
      contest({ registrationStartAt: undefined, registrationEndAt: undefined }),
      [],
    );
    // `unknown` must not collapse into `closed`: the copy for unset dates says
    // "to be confirmed", and the closed styling would contradict it.
    expect(data.registrationState).toBe('unknown');
    expect(data.registrationEndAt).toBeNull();
  });

  it('still reports open when only one end of the window is set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T00:00:00.000Z'));
    const data = buildOpenMicEditionStepsData(contest({ registrationEndAt: undefined }), []);
    expect(data.registrationStartAt).toBe(START);
    expect(data.registrationState).toBe('open');
  });

  it('is serialisable, because the client must not recompute any of it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T00:00:00.000Z'));
    const data = buildOpenMicEditionStepsData(contest(), []);
    expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data);
  });

  // The three state fields are the same type computed from the same three
  // arguments, so a builder that wires submission's result into
  // `registrationState` still passes every single-window test above. Only one
  // test with three *different* answers can tell the difference — and it has to
  // pin one instant, so the three windows are read against the same clock.
  it('labels each window from its own dates, never a neighbour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T00:00:00.000Z'));
    const data = buildOpenMicEditionStepsData(
      contest({
        registrationStartAt: '2026-09-01T00:00:00.000Z',
        registrationEndAt: '2026-09-30T23:59:59.000Z',
        // Submission stays on START/END (November) — open at this instant.
        votingConfig: {
          ...contest().votingConfig,
          votingStartAt: '2026-12-01T00:00:00.000Z',
          votingEndAt: '2026-12-31T23:59:59.000Z',
        },
      }),
      [],
    );
    expect(data.registrationState).toBe('closed');
    expect(data.submissionState).toBe('open');
    expect(data.votingState).toBe('not-started');
  });

  // Inclusive at both ends, because that is what the store does when it decides
  // whether to accept a submission (`persistence.ts:76-77` compares with
  // `>=`/`<=`). A page that says "closed" an hour before the deadline would
  // point artists away from a form that still takes them.
  it('is inclusive at both ends of the window, which is what the store does', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START));
    expect(buildOpenMicEditionStepsData(contest(), []).submissionState).toBe('open');
    vi.setSystemTime(new Date(END));
    expect(buildOpenMicEditionStepsData(contest(), []).submissionState).toBe('open');
    vi.setSystemTime(new Date(Date.parse(END) + 1));
    expect(buildOpenMicEditionStepsData(contest(), []).submissionState).toBe('closed');
    vi.setSystemTime(new Date(Date.parse(START) - 1));
    expect(buildOpenMicEditionStepsData(contest(), []).submissionState).toBe('not-started');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic/edition-steps-data.spec.ts`
Expected: FAIL — **6 failed / 16 passed (22 total)**. Six, because the seventh new test (`is serialisable`) asserts nothing about the new fields and passes before and after; the 15 pre-existing tests in the other `describe` blocks must still pass. `data.registrationState` reads as `undefined` (`received: undefined`) — the fields do not exist yet.

- [ ] **Step 3: Move the arithmetic into the read**

In `frontend-web/src/features/openmic/active-edition.ts`, add above `OpenMicEditionStepsData`:

```ts
/** Which side of a window the clock is on. A plain string union because this
 *  crosses the server/client boundary: the alternative was a client working it
 *  out during render, which pre-renders one answer and hydrates another. */
export type WindowState = 'open' | 'not-started' | 'closed' | 'unknown';

export function windowState(start: string | null, end: string | null, now: number): WindowState {
  const from = start ? Date.parse(start) : Number.NaN;
  const to = end ? Date.parse(end) : Number.NaN;
  if (!Number.isFinite(from) && !Number.isFinite(to)) return 'unknown';
  if (Number.isFinite(from) && now < from) return 'not-started';
  if (Number.isFinite(to) && now > to) return 'closed';
  return 'open';
}
```

In `OpenMicEditionStepsData`, add `registrationState: WindowState;` directly after `registrationEndAt`, `submissionState: WindowState;` after `submissionEndAt`, and `votingState: WindowState;` after `votingEndAt`.

In `buildOpenMicEditionStepsData`, hoist the six `at(...)` calls into locals and
resolve once against the server clock, so the returned object and the state
fields can never disagree:

```ts
  const registrationStartAt = at(contest.registrationStartAt);
  const registrationEndAt = at(contest.registrationEndAt);
  const submissionStartAt = at(contest.submissionStartAt);
  const submissionEndAt = at(contest.submissionEndAt);
  const votingStartAt = at(contest.votingConfig?.votingStartAt);
  const votingEndAt = at(contest.votingConfig?.votingEndAt);
  // One instant for all three windows: two `Date.now()` calls could straddle a
  // boundary and report the same window twice.
  const now = Date.now();
```

and in the returned object replace the six inline `at(...)` entries with those
locals plus:

```ts
    registrationState: windowState(registrationStartAt, registrationEndAt, now),
    submissionState: windowState(submissionStartAt, submissionEndAt, now),
    votingState: windowState(votingStartAt, votingEndAt, now),
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `cd /Users/paymax/Documents/spotlight/main/frontend-web && npx vitest run tests/unit/openmic/edition-steps-data.spec.ts`
Expected: all PASS — **22 in this file, 7 in the window-state `describe`** — including the pre-existing blocks.

- [ ] **Step 5: Make the component read the answer instead of doing the maths**

In `frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx`:

- Delete the local `type WindowState = …` line and the whole local `function windowState(…)`.
- Import the type instead: `import type { OpenMicEditionStepsData, WindowState } from '@/src/features/openmic/active-edition';` (a type-only import — the module pulls in server persistence and must never enter the client graph as a value).
- Delete `const now = Date.now();` and the three `const registration/submission/voting = windowState(…)` lines.
- Pass the resolved fields straight through at each `WindowLine`: `state={data.registrationState}`, `state={data.submissionState}`, `state={data.votingState}` (each is already inside a `data ? …` arm, so no new guard appears).
- Step #03's CTA decides on the field: `href={data.submissionState === 'open' ? \`/open-mic/${data.slug}/enter\` : \`/open-mic/${data.slug}/entries\`}` and the same field in the label ternary (`{data.submissionState === 'open' ? 'Submit your song' : 'See the live entries'}`).
- Every number the block prints is server-rendered HTML, so its formatting locale cannot be the host's either: a German visitor's browser renders `1500` as `1.500` against the server's `1,500` and React reports a text mismatch — the same hydration class as the window bug this task exists to kill. Declare `const LOCALE = 'en-GB';` beside `MAX_MP3_MB`, use it in `shortDate`, and pass it at all four numeric sites (`entry.voteCount.toLocaleString(LOCALE)`, `data.registrationFeeNgn.toLocaleString(LOCALE)`, `board.totalVotes.toLocaleString(LOCALE)`, `row.voteCount.toLocaleString(LOCALE)`).

- [ ] **Step 6: Compile, lint, and confirm nothing else moved**

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-web && npx tsc --noEmit > /tmp/tsc-9b.txt 2>&1; echo "tsc exit=$?"
npx eslint components/openmic/competition src/features/openmic/active-edition.ts > /tmp/lint-9b.txt 2>&1; echo "lint exit=$?"
npx vitest run tests/unit/openmic > /tmp/vitest-9b.txt 2>&1; echo "vitest exit=$?"
```
Expected: all three exit 0. `grep -c "Date.now()" components/openmic/competition/OpenMicEditionSteps.tsx` must be **0** — that is the whole point of the task, and it counts the whole file, comments included: the phrase may not appear even in prose explaining the bug, so the gate stays a plain grep rather than a judgement about which matches are code. `grep -c "toLocaleString()" components/openmic/competition/OpenMicEditionSteps.tsx` must also be **0** (every numeric render pins `LOCALE`). `npx vitest run tests/unit/openmic` is **36 passed**. The acceptance e2e stays red (5 failed / 0 passed) until Task 10 mounts the component; do not touch `tests/e2e/openmic/competition-steps.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git -C /Users/paymax/Documents/spotlight/main add frontend-web/src/features/openmic/active-edition.ts \
  frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx \
  frontend-web/tests/unit/openmic/edition-steps-data.spec.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "fix(open-mic): resolve the competition windows on the server, not during render

The steps block called Date.now() in the body, so a page whose window crossed a
boundary between the request and hydration rendered one answer into the server
HTML and another on the client — React 19 patches the text, but the step 03 CTA
it decides (/enter or /entries) is the part that would be wrong."
```

- [ ] **Step 8: Fix round, ruled after the task review**

The review returned PASS/APPROVED with nothing load-bearing, and three surviving
mutants worth closing here. The tree at `dfe925ad6` already has Steps 3-7; apply
exactly these two deltas, no others:

1. **The two tests Step 1 lists but the tree does not have** — `labels each
   window from its own dates, never a neighbour` and `is inclusive at both ends
   of the window, which is what the store does`. Append them inside the existing
   `describe('the three window states, resolved by the read', …)` and nothing
   else. They pass against the shipped builder; if either goes red, the builder
   is wrong, not the test.
2. **The `LOCALE` pinning Step 5 lists but the tree does not have** — one
   constant, four numeric sites, `shortDate` included.

Deliberately **not** asked for: a test that all three fields resolve from a
single `Date.now()`. With a frozen fake clock every call returns the same
instant, so per-field `Date.now()` cannot be observed to differ — a test that
cannot fail is a defect, and the invariant stays comment-guarded in
`active-edition.ts:127-129`.

Redo the Step 6 gate, then commit once:

```bash
git -C /Users/paymax/Documents/spotlight/main add frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx \
  frontend-web/tests/unit/openmic/edition-steps-data.spec.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "test(open-mic): pin the window-state fields to their own dates and each number to one locale

Field cross-wiring was invisible: three fields of one type from three argument
pairs, all November in the fixture, so any permutation passed. Only three
different windows at one instant can tell them apart. The numeric renders join
shortDate in pinning en-GB for the same reason the window state moved
server-side — the browser must not get to disagree with the HTML."
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

Proceed only when that path is clean (their work landed), and re-read the file first — the line numbers below are from the tree after the lounge-application feature landed (`b15194215`, `a5c31b2b1`; the page is 830 lines) and will move again if that page changes under this plan.

- [ ] **Step 2: Move the markup to the client shell**

Copy the current `page.tsx` to `frontend-web/components/openmic/competition/OpenMicCompetitionView.tsx` **verbatim** (it already starts with `'use client'`), then make exactly four edits:

1. Drop `import './open-mic.css';` (the route folder's CSS is imported by the server page now, so the shell has no relative path to it).
2. Delete the `stages` const (the five prose objects, currently lines 12-43) — `OpenMicEditionSteps` owns that copy now.
3. Change the default export to take the data and forward it, and replace the whole `<section … id="route">…</section>` block (`:673-712`) with the new component:

```tsx
import OpenMicEditionSteps from './OpenMicEditionSteps';
import type { OpenMicEditionStepsData } from '@/src/features/openmic/active-edition';

type Props = { data: OpenMicEditionStepsData | null };

export default function OpenMicCompetitionView({ data }: Props) {
```

   ```tsx
        <OpenMicEditionSteps data={data} />
   ```

4. Repoint the closing "Go to voting" CTA (`:813`, `href="/voting"` — `/voting` is the STEM plane and has nothing to do with Open Mic):

```tsx
              <a className="openMic-button openMic-buttonOutline" href={data ? `/open-mic/${data.slug}/entries` : '/open-mic'}>
                Go to voting <ArrowIcon />
              </a>
```

The `useState`/`useEffect` hash-open logic and `activeStage` now live in `OpenMicEditionSteps`; remove the now-unused copies from the shell (`:587` is `activeStage`, the `useEffect` spans `:589-600`) so lint does not flag them, and drop `useEffect` from the shell's React import — `:5` is its only occurrence in the file, so it must go.

The shell is not the only file Task 10 ends up touching. `OpenMicEditionSteps` laid its board cells side by side with nothing between them, and JSX drops the whitespace between adjacent elements, so a row's text read `…Street Light412 votesVote`: the acceptance spec's `\b412\b` could never match, and only the stylesheet could parse the copy. Put `{' '}` between the row's cells, with the comment that says why — the frozen spec is not the thing that is wrong here. The separators are layout-neutral: a whitespace-only run inside a grid container is a non-rendered anonymous grid item (`edition-steps.module.css:13` makes the `<li>` a grid), and the cells inside `.who` are block boxes, whose inter-element whitespace was never rendered either.

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

`next.config.mjs:39` already reads `distDir: process.env.DIST_DIR || '.next'`, so this is the exact switch — no config edit:

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-web && \
DIST_DIR=.next-verify-task11 NODE_OPTIONS=--max-old-space-size=8192 npm run build; echo "build exit: $?"
```
Expected: `build exit: 0`, and the running dev server's `.next` untouched. If the build dies with a heap exit (code 134) that is the memory ceiling, not a type error: raise `--max-old-space-size` and re-run — and report which run produced the green.

`$(mktemp -d)` cannot work here: Next rejects a distDir outside the project (`InvalidDistDirError`), so the scratch dir has to live inside the app. It is **not** ignored at this commit — `git show HEAD:.gitignore` has no `.next-verify*` or `.next-e2e*` rule (one exists only as another session's uncommitted edit, and does not cover the `.next-e2e*` name), so a scratch dir left behind is ~170–780MB of untracked noise for every other session in this shared worktree. Keep the name under `.next-verify*` and delete the directory when the build has reported.

- [ ] **Step 3: Run the acceptance gate serially, both projects, and repeat it**

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-web && \
E2E_BASE_URL=http://localhost:3111 npx playwright test tests/e2e/openmic/competition-steps.spec.ts \
  --workers=1 --project=chromium-desktop --repeat-each=3; echo "desktop exit: $?"
E2E_BASE_URL=http://localhost:3111 npx playwright test tests/e2e/openmic/competition-steps.spec.ts \
  --workers=1 --project=mobile-chrome --repeat-each=3; echo "mobile exit: $?"
```
Expected: `15 passed` each, exit 0.

Why the repeat: `openStep()` used to read `details.open` and click `summary` when it read false. Those are two CDP round trips, and the page's own hash handler (`OpenMicEditionSteps.tsx:116-126`) can land in the gap — then the click *closes* what the feature just opened. The exclusive accordion proves which order happened: in the red runs `#step-1` was collapsed too, and only the hash handler closes it. Three repeats per project is what distinguishes "fixed" from "lost the coin flip this time".

A red here is not automatically a product bug. The shared dev server on `:3000` can wedge while still holding the port (`lsof` shows a listener, `curl` returns `000` past 60s on every route, including `/`); that is an environment failure, not a gate failure. Never restart someone else's `:3000` — bring up a private server on another port with its own `DIST_DIR` and point the run at it with `E2E_BASE_URL` (which also disables Playwright's `webServer`, `playwright.config.mjs:28-30`).

- [ ] **Step 4: Confirm the committed tree is exactly this session's work**

```bash
cd /Users/paymax/Documents/spotlight/main && git status --porcelain | grep -v "^??" | head -20 && git log --oneline -8
```
Expected: the other sessions' files (`app/apply/[slug]/page.js`, `app/service-details/film-academy/*`, `components/layout/Menu.js`, `src/styles/tailwind.css`, `tests/unit/utility/*`, and either `page.js`'s deletion or the lounge files) still show as they did before this plan started, and the eight-or-so commits above are only this plan's paths.

- [ ] **Step 5: Report, then ask before pushing**

State: what went green and how it was proven; the dev-only rows and beat file left behind in Task 7 (and that nothing was written to production); that `tests/unit/openmic` + `tests/unit/media` are not in a CI lane and offer that as a follow-up; and the four pre-existing bugs the spec names (drawer `.mean-nav` off-panel at 390px, `src/components/Header.tsx:33` → `/contestant-leaderboard` with no route, Footer2 dark-on-dark links, `components/sections/Service3.js:16` → the `/service` page pending deletion under task #127). Do not push without the user's go-ahead.

---

### Task 12: Make step 05 mean what it says (final whole-branch review fixes)

**Why this task exists.** The final review found two places where step 05 claims a property it does not deliver:

1. `OpenMicEditionSteps.tsx` prints "This edition keeps its standings private until the results are announced."
   and then, **outside every branch** of the same ternary chain, renders a "Full leaderboard" link to the page
   that shows all of them. One click refutes the sentence above it.
2. `active-edition.ts` put every row's `voteCount` and the board's `totalVotes` into the RSC payload whatever
   `voteCountPublic` said; the client only declined to *display* them. A value in the payload is delivered, not
   shown, so the admin's switch was cosmetic.

Spec H2 and the step 05 row of the spec's coverage table are amended in the commit before this brief, and that
amended text is the authority for everything below.

**Files:**
- Modify: `frontend-web/src/features/openmic/active-edition.ts` (type at `:96` and `:98`; builder at `:146-148`, `:170`, `:174`)
- Modify: `frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx` (`:259`, `:277`, `:288-291`)
- Modify: `frontend-web/tests/unit/openmic/edition-steps-data.spec.ts` (one new case)
- Modify: `frontend-web/tests/e2e/openmic/competition-steps.spec.ts` (`openStep()` only)

**Do not touch** `components/openmic/OpenMicAdminContestBuilder.tsx`, `OpenMicAdminContestEditor.tsx` or
`tests/unit/openmic/admin-beat-wiring.spec.ts`. The review recommended deleting them as dead code, and that
recommendation is **rejected**: this repo has no `frontend-web/app/admin` tree, but `paymax2022/spotlight-latest@main`
(the deployed console) mounts both — `app/admin/(dashboard)/open-mic/contests/new/page.tsx` renders the builder and
`[contestId]/edit/page.tsx` the editor. Unreachable in this repo is not the same fact as dead.

**Interfaces:** `OpenMicEditionStepsData.board` changes shape: `rows[].voteCount: number | null` and
`totalVotes: number | null`. `showLeaderboard` / `showVoteCounts` stay in the payload (`showLeaderboard` is read by
the component; `showVoteCounts` keeps the derivation pinned by the existing unit case at `:153`) — no consumer
branches on `showVoteCounts` any more, and that is deliberate: the switch is resolved where the payload is built.

- [ ] **Step 1: Hide the counts in the data, not in the markup**

In `frontend-web/src/features/openmic/active-edition.ts`, replace the two board type lines

```ts
    rows: { rank: number; artistSlug: string; stageName: string; songTitle: string; voteCount: number }[];
    entryCount: number;
    totalVotes: number;
```

with

```ts
    rows: {
      rank: number; artistSlug: string; stageName: string; songTitle: string;
      /** `null` when the admin hid the counts. The number stays out of the
       *  payload rather than being shipped for the client to hide. */
      voteCount: number | null;
    }[];
    entryCount: number;
    totalVotes: number | null;
```

Hoist the two switch reads out of the return object — insert above `  return {`:

```ts
  const showLeaderboard = contest.votingConfig?.leaderboardVisible !== false;
  const showVoteCounts = contest.votingConfig?.voteCountPublic !== false;
```

and replace the two inline fields

```ts
    showLeaderboard: contest.votingConfig?.leaderboardVisible !== false,
    showVoteCounts: contest.votingConfig?.voteCountPublic !== false,
```

with the shorthand

```ts
    showLeaderboard,
    showVoteCounts,
```

Then, inside the `board` projection, resolve the counts:

```ts
            voteCount: showVoteCounts ? row.voteCount : null,
```

```ts
          totalVotes: showVoteCounts ? board.reduce((sum, row) => sum + row.voteCount, 0) : null,
```

`entryCount` is not a vote count and stays a number.

- [ ] **Step 2: Render from the payload, and stop handing out what was hidden**

In `frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx`, the tally line

```tsx
                            {data.showVoteCounts ? ` · ${board.totalVotes.toLocaleString(LOCALE)} votes counted` : ''}
```

becomes

```tsx
                            {board.totalVotes !== null ? ` · ${board.totalVotes.toLocaleString(LOCALE)} votes counted` : ''}
```

the row count

```tsx
                                <span className={styles.votes}>{data.showVoteCounts ? `${row.voteCount.toLocaleString(LOCALE)} votes` : '—'}</span>{' '}
```

becomes

```tsx
                                <span className={styles.votes}>{row.voteCount !== null ? `${row.voteCount.toLocaleString(LOCALE)} votes` : '—'}</span>{' '}
```

and the unconditionally-rendered hand-off

```tsx
                      <div className="openMic-actions">
                        <Link className="openMic-button openMic-buttonOutline" href={`/open-mic/${data.slug}/entries`}>Full leaderboard <span aria-hidden="true">→</span></Link>
                      </div>
```

becomes

```tsx
                      {/* Gated on the same switch as the board itself: a hand-off
                          to the full standings would refute the "standings private"
                          note two lines above it. */}
                      {data.showLeaderboard && (
                        <div className="openMic-actions">
                          <Link className="openMic-button openMic-buttonOutline" href={`/open-mic/${data.slug}/entries`}>Full leaderboard <span aria-hidden="true">→</span></Link>
                        </div>
                      )}
```

The per-row `Vote` link and the "Vote now" CTA already live inside the `showLeaderboard`-true arm, so they need
no change. `data.showVoteCounts` should now appear nowhere in this file.

- [ ] **Step 3: Pin the hidden arm in the unit data tests**

Append to the board describe block in `frontend-web/tests/unit/openmic/edition-steps-data.spec.ts`. The existing
cases only ever flip both switches together (`:153`), and none of them looks at the numbers, so a payload that
keeps shipping them would pass the file as it stands:

```ts
  it('leaves hidden counts out of the payload, not just out of the markup', () => {
    const hidden = buildOpenMicEditionStepsData(
      contest({ votingConfig: { ...contest().votingConfig, voteCountPublic: false } }),
      [entry(1), entry(2), entry(3)],
    );
    expect(hidden.showVoteCounts).toBe(false);
    expect(hidden.board?.rows.map((row) => row.voteCount)).toEqual([null, null, null]);
    expect(hidden.board?.totalVotes).toBeNull();
    // An entry count is not a vote count, so the switch does not remove it.
    expect(hidden.board?.entryCount).toBe(3);
  });

  it('still delivers the counts when the switch is left on', () => {
    const shown = buildOpenMicEditionStepsData(contest(), [entry(1), entry(2), entry(3)]);
    expect(shown.board?.rows.map((row) => row.voteCount)).toEqual([10, 20, 30]);
    expect(shown.board?.totalVotes).toBe(60);
  });
```

Use the `contest()` / `entry(n)` helpers already at the top of that file (`entry(n)` sets `voteCount: n * 10`),
and the existing `toStrictEqual` round-trip case stays as it is — `null` serialises, so the payload remains
RSC-safe.

- [ ] **Step 4: Make the acceptance helper prove the accordion**

In `frontend-web/tests/e2e/openmic/competition-steps.spec.ts`, `openStep()` currently waits only for the named
panel. After its existing `expect.poll(...).toBe(true)` and before `return panel;`, add the other half of the
contract:

```ts
  if (step !== 1) {
    // The other side of the same contract: SSR ships #step-1 open, so only the
    // hash handler opening this panel can close it. Asserting it pins the
    // exclusive accordion itself — a page that lost the `name` grouping would
    // still pass the check above.
    await expect
      .poll(() => page.locator('#step-1').evaluate((el) => (el as HTMLDetailsElement).open), {
        message: '#step-1 must close when the hash opens a later step',
      })
      .toBe(false);
  }
```

No other test in that file changes: it asserts `Vote now` and the closing CTA while both switches are on, which
is still true after Step 2.

- [ ] **Step 5: Run the gates that cover these files**

```bash
cd /Users/paymax/Documents/spotlight/main/frontend-web && \
npx vitest run tests/unit/openmic tests/unit/media/open-mic-beat-storage.test.ts; echo "vitest exit: $?"
npx tsc --noEmit; echo "tsc exit: $?"
npx eslint components/openmic/competition/OpenMicEditionSteps.tsx src/features/openmic/active-edition.ts \
  tests/unit/openmic/edition-steps-data.spec.ts tests/e2e/openmic/competition-steps.spec.ts; echo "eslint exit: $?"
```

Expected: all four exit 0. `tsc` is the check that matters here — `number | null` reaching two `.toLocaleString()`
call sites is exactly the kind of change that compiles only after the render side is fixed too.

- [ ] **Step 6: Re-verify the two byte-identity invariants**

The plan's Task 9 fence is the whole component file and the Task 8 fence is the whole e2e file. Both fences were
amended in the commit before this brief; after this task's edits they must match again, exactly:

```bash
cd /Users/paymax/Documents/spotlight/main && python3 - <<'PY'
import re
plan = open('docs/superpowers/plans/2026-11-10-open-mic-competition-steps.md').read()
def fences(marker_a, marker_b):
    region = plan.split(marker_a)[1].split(marker_b)[0]
    return re.findall(r'```tsx\n(.*?)```', region, re.S) + re.findall(r'```ts\n(.*?)```', region, re.S)
big = max(fences('### Task 9:', '### Task 9b:'), key=len)
spec = max(fences('### Task 8:', '### Task 9:'), key=len)
for text, path in ((big, 'frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx'),
                   (spec, 'frontend-web/tests/e2e/openmic/competition-steps.spec.ts')):
    live = open(path).read()
    print(('IDENTICAL' if text == live else 'DRIFT'), path, len(text.splitlines()), len(live.splitlines()))
PY
```

Expected: `IDENTICAL` on both lines. If it says `DRIFT`, the plan and the shipped file disagree, and the plan is
the document the next reviewer will trust — fix whichever is wrong, do not record the mismatch.

- [ ] **Step 7: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main && \
git add frontend-web/src/features/openmic/active-edition.ts \
        frontend-web/components/openmic/competition/OpenMicEditionSteps.tsx \
        frontend-web/tests/unit/openmic/edition-steps-data.spec.ts \
        frontend-web/tests/e2e/openmic/competition-steps.spec.ts && \
git commit -m "fix(open-mic): honour the display switches in what step 05 ships, not only in what it draws"
```

Stage by these exact paths — the shared worktree carries other sessions' in-flight files, and `git add -A` would
sweep them into this commit.

The switch-OFF arms in the browser (the plan's gate runs with both switches on) are measured by the controller
with a reversible flip-and-restore of the dev fixture row, because that touches shared dev DB state and is not
subagent work. Nothing in this task may write to the database.

---

## Self-review notes

- **Spec coverage:** B/C → Task 1–2; D → Task 2 + Task 6; E → Task 1 (`publicBeatUrl`), Task 3 (edition page), Task 5 (data), Task 6 (admin warnings); F → Task 10; G → Task 4; H/H2 → Tasks 5 + 9, closed honestly by Task 12; I → Task 5 (`slugifyArtist` in the builder, so the client never re-slugs) and Task 9's own entry link; J → Task 7; Testing → Tasks 1–8, 11. Out-of-scope items are untouched.
- **No placeholders:** every code block is the code. The only run-time values are Task 7's `<contestId>` / `<previewUrl>` / `<downloadUrl>` substitutions, and each names the command immediately above that prints it.
- **Six deltas folded in from research, overriding the spec's wording:** the real contest type is `one_beat_one_verse` (not `open_mic`); `previewOnly` is hardcoded `false` on the DB path, so `is_active → allowDownload` is the only download switch that exists; the status allowlist is the 11-entry `CURRENT_OPEN_MIC_STATUSES` (`active-edition.ts:20-32`), widened past the spec's short list because the narrow list blanks the page during `beat_available`/`submission_closed`/`under_review`; the upload route's `contestId` is optional and token-validated because the builder uploads before the contest row exists, and the accepted MIME set is `audio/mp3|audio/mpeg` because that is what browsers actually report; the download filename is named by the reader route's `Content-Disposition` (built from the uuid object key), and the anchor's `download` attribute is only best effort — Chromium lets the response header win, so a readable stem would have to go into the key itself (final review, Minor 1; no task changes the key); and the two admin display switches are honoured by the panel not rendering hidden affordances and by the server omitting hidden numbers, not by a client branch that still receives them (Task 12).
- **Spec line references are stale by design:** they were taken from the committed page (701 lines) while the working tree now has 835 after another session's lounge-application work. This plan quotes the working-tree numbers and re-checks them at Task 10 Step 1.
