# Contest Template Studio (P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an admin-authored contest template actually reachable by the compositing pipeline, then give the console the studio that authors it — real slot art, blend parameters, a synchronous sample-portrait preview, and duplicate → edit → publish → version lifecycle.

**Architecture:** One trust rule lives in `src/lib/config` and is consulted by both remote-image readers (`imageCompositor.fetchImageBuffer`, `photo-jobs/assets.fetchAllowed`), so the two cannot disagree about what a template URL may be. A thin reader module (`src/lib/media/template-image.ts`) turns that rule into bytes plus a named reason, and the render path that P2 built is extracted into one reusable unit (`blend/composite.ts`) that both the job runner and the new preview route call. Publishing materialises a new immutable row through Postgres RPCs rather than mutating the row a queue is keyed on, and every admin write is a thin route over a `src/server/template-studio` module so the contract is testable without a database.

**Tech Stack:** Next.js 16.4.6 App Router (route handlers, `multipart/form-data`, binary `NextResponse`), TypeScript strict, sharp 0.33, `@supabase/supabase-js` (service-role admin client), Supabase Postgres migrations + `security definer` RPCs, vitest (node environment) for `frontend-web`/`frontend-admin`, Go + pgx live-DB suites in `backend/tests/voting`.

**Spec:** `docs/superpowers/specs/2026-11-27-contest-template-studio-design.md`

**Branch / workspace:** `feat/contest-template-studio` in `.worktrees/contest-template-studio`, stacked on `feat/contest-photo-blend-layer` (`7c7ead9e8`, PR #1181), whose base is `feat/contest-photo-assets-jobs` (`ff1e3e304`, PR #1180). All `npm`/`vitest` commands below run from `frontend-web/` unless the step says otherwise. The PR target is `feat/contest-photo-blend-layer`, never `main`.

## Global Constraints

- **No new dependencies** in any package. sharp, vitest, pgx, `@testing-library/react` and `@testing-library/jest-dom` are already present; nothing else may be added.
- **The image-host check stays an exact-comparison rule.** Allowed = a hostname literally in `allowedRemoteImageHostnames` over `https:`, **or** an origin byte-for-byte equal to the configured Supabase origin serving a public object under an allowlisted bucket. Never a suffix match, never a CIDR/loopback rule, never "any host the DB row names".
- **Reply in English**, code comments included.
- **Error codes are snake_case and every refusal sentence names what to change** (`template_is_published`, `blend_setting_unknown`, …), because `frontend-admin` shows `error` verbatim.
- **Migration version for this phase is `20272300000000`** — the newcomer rule enforced by `scripts/ci/check-migration-versions.sh` against `origin/main`'s ceiling `20272000000000` (P1 took `20272100000000`, P2 took `20272200000000`).
- **Migrations are additive only** (`add column if not exists`, `create index if not exists`, `create or replace function`). No drop, no backfill `update`, no partial unique index — a red `migrate` leg is an outage, and duplicates that already exist must not become a failure.
- **Never write to the shared dev database** (`backend/.env DATABASE_URL` → `localhost:54322`) beyond reading it, and never run `make migrate-reset` against it. Chain proofs happen in a scratch database created on the same server, dropped at the end of the task.
- **`security definer` RPC preamble is house style**, verbatim on every function: `revoke all on function public.<name>(…) from public, anon, authenticated;` then `grant execute on function public.<name>(…) to service_role;`, `set search_path = public, pg_temp`, fully-qualified `public.` table names, `jsonb` return, `raise exception … using errcode = '22023'`.
- **TDD, red first:** write the failing test, run it, read the failure, then implement. Commit once per task, message prefixed `feat(contest-studio):` / `fix(contest-studio):` / `test(contest-studio):`.
- **Do not merge to `main` and do not deploy.** A merge to `main` here is itself a production release (see project memory: `release.yml` deploys on merge). The deliverable ends at a stacked PR with a measured CI census.
- **Do not touch** `feat/mobile-menu-visibility`, or `src/features/voting/components/ContestantImage.tsx` and the ten voting surfaces that use it. That is another session's branch.

### Facts pinned by execution while scoping (do not re-derive)

| Fact | Evidence |
| --- | --- |
| The app's only Supabase URL env is `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/{server,client,runtime}.ts` all read it; nothing in the repo reads `SUPABASE_URL` |
| Dev value | `frontend-web/.env.local:1` → `http://127.0.0.1:54321` |
| Production shape | `.env.example:14`, `.env.production.example:39` → `https://YOUR_PROJECT.supabase.co` |
| The admin create route stores exactly that origin | `app/api/admin/voting/contest-templates/route.ts:205-228` — key `templates/<contestId>/<uuid>.<ext>`, URL from `getPublicUrl` |
| Three real rows exist in the dev DB and serve bytes | `curl` per row → `200 165840B image/jpeg`, `200 2849495B image/png`, `200 2849495B image/png`; all three `status = 'draft'` |
| Only two production callers use the guard | `src/server/photo-jobs/assets.ts:32`, `src/lib/rendering/imageCompositor.ts:123` |
| The blend test masks the defect | `tests/unit/photo-jobs/blend/runner-blend.test.ts:185` mocks `https://cdn.test/template.png` |
| `contest_templates` has no `updated_by` column | `information_schema.columns` → `created_by, created_at, updated_at` only |
| Enums | `template_status = draft,active,archived`; `template_slot_type = contestant,runner_up,badge,logo,custom`; `template_crop_mode = cover,contain,fill,none` |
| Go live-DB home | `backend/tests/voting/` = `package voting_test`, helper `votingPool(t)` (`fixtures_test.go:53`), `newContest(t,ctx,pool,contestOpts{})` seeds `connect_contests`, gate is `TEST_DATABASE_URL` only |
| vitest scope | `vitest.config.ts:16-18` → `environment: 'node'`, include `tests/unit/**/*.test.ts|spec.ts` |
| Production rows already hold the configured origin | Read-only memory record (proved from the served `_next/static/chunks/*.js`, not a credential): prod `template_url` is `https://nmseefdlliejmdbxytej.supabase.co/storage/v1/object/public/contest-templates/…`, i.e. exactly the `getPublicUrl()` shape. So Task 1 repairs **production**, not only dev, and needs no new variable — the trusted origin is the one `NEXT_PUBLIC_SUPABASE_URL` already carries there |
| The refusal is reachable today | `resolveActiveTemplateForContest` → `compositeImage` is live on `origin/main`, so a prod template with an active contest throws `Remote image host is not allowed` (only P2's `applied:false` degrade reporting is unmerged) |

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend-web/src/lib/config/index.ts` | modify | The single trust rule: literal CDN hosts **or** the configured Supabase origin serving a public object of an allowlisted bucket. |
| `frontend-web/src/lib/media/template-image.ts` | create | Turn a stored `template_url`/`image_url` into bytes plus a named failure reason; expose a synchronous `templateImagePlan` so a config page can census without network. |
| `frontend-web/tests/unit/config/trusted-image-origin.test.ts` | create | Both directions of the trust rule, including the shapes that must stay refused. |
| `frontend-web/tests/unit/media/template-image.test.ts` | create | Plan parsing and byte reads (`tests/unit/media/` already exists). |
| `frontend-web/src/lib/rendering/blend/composite.ts` | create | One call = blend engine + compositor, returning pixels and the decision record. Shared by the runner and the preview route. |
| `frontend-web/src/server/photo-jobs/runner.ts` | modify | Reads template bytes through `readTemplateImage`; delegates the blend branch to `compositeWithBlend`. |
| `frontend-web/tests/unit/photo-jobs/blend/runner-blend.test.ts` | modify | Real production-shaped template URL; the regression case the mock was hiding. |
| `supabase/migrations/20272300000000_contest_template_studio.sql` | create | `published_at`/`published_by`, parent index, four RPCs. |
| `backend/tests/voting/template_studio_live_db_test.go` | create | Live proofs of the lifecycle invariants (they have no JS lane). |
| `frontend-web/src/server/template-studio/authoring.ts` | create | Studio-field validation, publish delegation helpers, RPC failure mapping. |
| `frontend-web/app/api/admin/voting/contest-templates/_shared.ts` | modify | Row mappers gain the P2/P3 columns; `uuidOr`; `studioRpcFailure`. |
| `…/contest-templates/route.ts`, `…/[templateId]/route.ts`, `…/[templateId]/slots/route.ts` | modify | Studio fields on create/PATCH, draft-gating, slot art round-trip, publish delegation. |
| `…/[templateId]/{preview,duplicate,publish,archive,versions,slot-art}/route.ts` | create | The studio surface. |
| `frontend-web/app/api/admin/photo-config-status/route.ts` | modify | Template-read census + the blend bounds the console renders sliders from. |
| `frontend-admin/src/services/contestTemplatesService.ts`, `app/admin/voting/templates/TemplateStudio.tsx`, `app/admin/voting/templates/page.tsx` | modify/create | The console half: types, studio panel, wiring. |

---

## Task 1: The trust rule — configured Supabase origin, exact match

**Files:**
- Modify: `frontend-web/src/lib/config/index.ts` (the array at ~`:78` and `isAllowedRemoteImageUrl` at ~`:89`)
- Test: `frontend-web/tests/unit/config/trusted-image-origin.test.ts` (create; `tests/unit/config/` exists)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const TEMPLATE_STORAGE_BUCKETS = ['contest-templates'] as const`
  - `export const PUBLIC_OBJECT_PATH_PREFIX = '/storage/v1/object/public/'`
  - `export function configuredSupabaseOrigin(): string | null`
  - `export function isConfiguredSupabaseOrigin(value: string): boolean`
  - `export function isAllowedRemoteImageUrl(value: string): boolean` — signature unchanged, meaning extended.

- [x] **Step 1: Write the failing test.** Cover the acceptance list, in both directions, with the dev shape the database actually holds and the production shape the examples document.

```ts
/**
 * The image-host guard, both directions.
 *
 * Why this file exists: the admin create route writes
 * `<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/contest-templates/…`
 * and every compositing reader refused it, because the allowlist only named
 * third-party CDNs. The fix has to widen exactly one origin and nothing else,
 * so the refusals below are the test — a guard that reads a stored row's host
 * as trusted is an SSRF primitive, not a convenience.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  configuredSupabaseOrigin,
  isAllowedRemoteImageUrl,
  isConfiguredSupabaseOrigin,
} from '@/lib/config';

const DEV_ORIGIN = 'http://127.0.0.1:54321';
const DEV_OBJECT = `${DEV_ORIGIN}/storage/v1/object/public/contest-templates/templates/c1/a.png`;
const PROD_ORIGIN = 'https://demo-project.supabase.co';
const PROD_OBJECT = `${PROD_ORIGIN}/storage/v1/object/public/contest-templates/templates/c1/a.png`;
const KEY = 'NEXT_PUBLIC_SUPABASE_URL';
const previous = process.env[KEY];

afterEach(() => {
  if (previous === undefined) delete process.env[KEY];
  else process.env[KEY] = previous;
});

describe('configured origin is trusted, exactly', () => {
  it('accepts the URL shape the admin console writes in dev', () => {
    process.env[KEY] = DEV_ORIGIN;
    expect(configuredSupabaseOrigin()).toBe(DEV_ORIGIN);
    expect(isConfiguredSupabaseOrigin(DEV_ORIGIN)).toBe(true);
    expect(isAllowedRemoteImageUrl(DEV_OBJECT)).toBe(true);
  });

  it('accepts the production shape too', () => {
    process.env[KEY] = PROD_ORIGIN;
    expect(isAllowedRemoteImageUrl(PROD_OBJECT)).toBe(true);
  });

  it('refuses a different port on the same host', () => {
    process.env[KEY] = DEV_ORIGIN;
    expect(isAllowedRemoteImageUrl(
      'http://127.0.0.1:9999/storage/v1/object/public/contest-templates/templates/c1/a.png',
    )).toBe(false);
  });

  it('refers http when the config says https, and the other way round', () => {
    process.env[KEY] = PROD_ORIGIN;
    expect(isAllowedRemoteImageUrl(
      'http://demo-project.supabase.co/storage/v1/object/public/contest-templates/a.png',
    )).toBe(false);
    process.env[KEY] = DEV_ORIGIN;
    expect(isAllowedRemoteImageUrl(
      'https://127.0.0.1:54321/storage/v1/object/public/contest-templates/a.png',
    )).toBe(false);
  });

  it('refuses credentials smuggled into the URL', () => {
    process.env[KEY] = DEV_ORIGIN;
    expect(isAllowedRemoteImageUrl(
      'http://postgres:pw@127.0.0.1:54321/storage/v1/object/public/contest-templates/a.png',
    )).toBe(false);
  });

  it('refuses another bucket of the same origin, and a non-object path', () => {
    process.env[KEY] = DEV_ORIGIN;
    expect(isAllowedRemoteImageUrl('http://127.0.0.1:54321/storage/v1/object/private/contest-templates/a.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://127.0.0.1:54321/storage/v1/object/public/avatars/a.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('http://127.0.0.1:54321/rest/v1/contest_templates')).toBe(false);
  });

  it('refuses a prefix look-alike host', () => {
    process.env[KEY] = PROD_ORIGIN;
    expect(isAllowedRemoteImageUrl('https://demo-project.supabase.co.evil.test/storage/v1/object/public/contest-templates/a.png')).toBe(false);
  });

  it('is inert when the app has no Supabase URL configured', () => {
    delete process.env[KEY];
    expect(configuredSupabaseOrigin()).toBeNull();
    expect(isAllowedRemoteImageUrl(`${DEV_ORIGIN}/storage/v1/object/public/contest-templates/a.png`)).toBe(false);
  });
});

describe('the literal CDN entries still work', () => {
  it('accepts each allowlisted host over https and refuses it over http', () => {
    process.env[KEY] = 'http://127.0.0.1:54321';
    expect(isAllowedRemoteImageUrl('https://res.cloudinary.com/demo/x.png')).toBe(true);
    expect(isAllowedRemoteImageUrl('https://images.unsplash.com/x')).toBe(true);
    expect(isAllowedRemoteImageUrl('http://res.cloudinary.com/demo/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('https://evil.test/x.png')).toBe(false);
    expect(isAllowedRemoteImageUrl('not a url')).toBe(false);
  });
});
```

- [x] **Step 2: Run it, read the red.** `npx vitest run tests/unit/config/trusted-image-origin.test.ts` — expect failures naming `configuredSupabaseOrigin` as not exported, and the dev-object case returning `false` (that `false` **is** the defect).
- [x] **Step 3: Implement.** Add beside the existing array, then extend the predicate. `isAllowedRemoteImageUrl` must stay one function: its two callers (`photo-jobs/assets.ts:32`, `imageCompositor.ts:123`) then agree by construction, which is the point of requirement 2.

```ts
/**
 * Buckets whose *public* objects the compositing readers may fetch from our own
 * Storage. `contest-templates` is the bucket `20260405700000_contest_image_templates.sql`
 * creates public and that `…/contest-templates/route.ts:227` writes; a private
 * bucket is deliberately absent, because reaching it is a storage-API call with
 * a service key, not a URL the renderer may fetch.
 */
export const TEMPLATE_STORAGE_BUCKETS = ['contest-templates'] as const;

export const PUBLIC_OBJECT_PATH_PREFIX = '/storage/v1/object/public/';

/**
 * The origin this app's own Supabase client would use, protocol+host+port.
 *
 * Server-side env, never a value that came from a request or a database row:
 * that is what makes an exact comparison here safe. `NEXT_PUBLIC_SUPABASE_URL`
 * is the only Supabase URL the repo reads (src/lib/supabase/server.ts:16), so
 * this adds no new configuration — dev resolves to http://127.0.0.1:54321 and
 * production to https://<project>.supabase.co from the same variable that
 * already has to be set for the app to start.
 */
export function configuredSupabaseOrigin(): string | null {
  const raw = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!url.host) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isConfiguredSupabaseOrigin(value: string): boolean {
  const trusted = configuredSupabaseOrigin();
  if (!trusted) return false;
  try {
    return new URL(value).origin === trusted;
  } catch {
    return false;
  }
}

/** True for `/storage/v1/object/public/<allowlisted bucket>/<key>`. */
function isPublicTemplateObject(parsed: URL): boolean {
  if (!parsed.pathname.startsWith(PUBLIC_OBJECT_PATH_PREFIX)) return false;
  const rest = parsed.pathname.slice(PUBLIC_OBJECT_PATH_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return false;
  const bucket = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  if (!key) return false;
  return (TEMPLATE_STORAGE_BUCKETS as readonly string[]).includes(bucket);
}

export function isAllowedRemoteImageUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (
    parsed.protocol === 'https:' &&
    allowedRemoteImageHostnames.includes(parsed.hostname as (typeof allowedRemoteImageHostnames)[number])
  ) {
    return true;
  }
  // Our own bucket, on our own configured origin, for a public template object.
  // Byte-for-byte origin equality: a port, scheme or host difference fails, and
  // so does every path that is not a public `contest-templates` object.
  return parsed.origin === configuredSupabaseOrigin() && isPublicTemplateObject(parsed);
}
```

- [x] **Step 4: Run the new file plus the suite that already asserts the guard's neighbours.** `npx vitest run tests/unit/config tests/unit/photo-jobs/assets.test.ts tests/unit/rendering` — expect all pass (`assets.test.ts` mocks the guard, so it is unaffected; `tests/unit/photo-jobs/blend/*` may show the `cdn.test` cases still green — Task 3 replaces them).
- [x] **Step 5: `npm run type-check`, then commit** `git add -A src/lib/config tests/unit/config && git commit -m "fix(contest-studio): trust the configured Supabase origin for template objects"`.

## Task 2: `readTemplateImage` — bytes, or a named reason

**Files:**
- Create: `frontend-web/src/lib/media/template-image.ts`
- Test: `frontend-web/tests/unit/media/template-image.test.ts`

**Interfaces:**
- Consumes: `isAllowedRemoteImageUrl`, `PUBLIC_OBJECT_PATH_PREFIX`, `TEMPLATE_STORAGE_BUCKETS` from Task 1.
- Produces:
  - `export type TemplateReadFailure = 'empty' | 'not-a-url' | 'host-not-allowed' | 'bucket-not-allowed' | 'not-fetchable' | 'http-status'`
  - `export type TemplateImagePlan = { kind: 'storage'; bucket: string; key: string } | { kind: 'remote' } | { kind: 'refused'; reason: TemplateReadFailure }`
  - `export function templateImagePlan(value: string | null | undefined): TemplateImagePlan`
  - `export type TemplateImageRead = { ok: true; bytes: Buffer } | { ok: false; reason: TemplateReadFailure; status?: number }`
  - `export function readTemplateImage(value: string | null | undefined): Promise<TemplateImageRead>`

- [x] **Step 1: Failing test.** The plan is what the config page will census without spending a request, so it is tested on its own; the read is tested against a stubbed `globalThis.fetch`.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readTemplateImage, templateImagePlan } from '@/src/lib/media/template-image';
import { isAllowedRemoteImageUrl } from '@/lib/config';

const ORIGIN = 'http://127.0.0.1:54321';
const KEY = 'NEXT_PUBLIC_SUPABASE_URL';
const stored = `${ORIGIN}/storage/v1/object/public/contest-templates/templates/c1/a.png`;

beforeEach(() => { process.env[KEY] = ORIGIN; });
afterEach(() => { delete process.env[KEY]; vi.unstubAllGlobals(); });

describe('templateImagePlan', () => {
  it('names the storage object the admin console wrote', () => {
    expect(templateImagePlan(stored)).toEqual({
      kind: 'storage', bucket: 'contest-templates', key: 'templates/c1/a.png',
    });
  });
  it('names a CDN object remote', () => {
    expect(templateImagePlan('https://res.cloudinary.com/demo/x.png')).toEqual({ kind: 'remote' });
  });
  it('refuses the shapes the guard refuses, with the reason that says why', () => {
    expect(templateImagePlan('')).toEqual({ kind: 'refused', reason: 'empty' });
    expect(templateImagePlan(null)).toEqual({ kind: 'refused', reason: 'empty' });
    expect(templateImagePlan('nonsense')).toEqual({ kind: 'refused', reason: 'not-a-url' });
    expect(templateImagePlan('https://evil.test/x.png')).toEqual({ kind: 'refused', reason: 'host-not-allowed' });
    expect(templateImagePlan(`${ORIGIN}/storage/v1/object/public/avatars/a.png`))
      .toEqual({ kind: 'refused', reason: 'bucket-not-allowed' });
  });
});

describe('readTemplateImage', () => {
  it('returns bytes for a stored template URL — the read that used to be impossible', async () => {
    const fetch = vi.fn(async () => new Response(Buffer.from('template-png-bytes'), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const read = await readTemplateImage(stored);
    expect(read).toEqual({ ok: true, bytes: Buffer.from('template-png-bytes') });
    expect(fetch).toHaveBeenCalledWith(stored, { cache: 'no-store', redirect: 'follow' });
  });

  it('refuses a host the guard refuses without touching the network', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await readTemplateImage('https://evil.test/x.png')).toEqual({ ok: false, reason: 'host-not-allowed' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a non-2xx with its status, so the job record can say so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    expect(await readTemplateImage(stored)).toEqual({ ok: false, reason: 'http-status', status: 404 });
  });

  it('refuses a redirect that lands somewhere else', async () => {
    const target = 'https://evil.test/x.png';
    const response = new Response(Buffer.from('bytes'), { status: 200 });
    Object.defineProperty(response, 'url', { value: target });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    expect(await readTemplateImage(stored)).toEqual({ ok: false, reason: 'redirected-off-origin' as never });
  });
});
```

The last case needs a seventh failure name: add `'redirected-off-origin'` to `TemplateReadFailure` in Step 3 (the test states the intent first; the union grows to match it).

- [x] **Step 2: Run, read red** (`Cannot find module '@/src/lib/media/template-image'`).
- [x] **Step 3: Implement.**

```ts
/**
 * Reading the bytes behind a template's stored image URL (spec §5).
 *
 * The URL in `contest_templates.template_url` is written by the admin create
 * route as a public Storage object on this project's own origin, and before this
 * module every reader of it either degraded silently or threw. The trust rule is
 * NOT duplicated here — `isAllowedRemoteImageUrl` owns it (Task 1) so the job
 * runner, the compositor and this reader cannot drift apart. What this file adds
 * is the part a boolean cannot express: which shape a value was, and therefore
 * what an operator should do about it.
 *
 * The reason strings are load-bearing. They land in `render_params.blend.error`
 * and in the preview route's response code, where "the bytes could not be read"
 * told nobody whether the row, the bucket or the network was at fault.
 */
import {
  isAllowedRemoteImageUrl,
  PUBLIC_OBJECT_PATH_PREFIX,
  TEMPLATE_STORAGE_BUCKETS,
  configuredSupabaseOrigin,
} from '@/lib/config';

export type TemplateReadFailure =
  | 'empty' | 'not-a-url' | 'host-not-allowed' | 'bucket-not-allowed'
  | 'not-fetchable' | 'http-status' | 'redirected-off-origin';

export type TemplateImagePlan =
  | { kind: 'storage'; bucket: string; key: string }
  | { kind: 'remote' }
  | { kind: 'refused'; reason: TemplateReadFailure };

export type TemplateImageRead =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: TemplateReadFailure; status?: number };

const bucketOf = (pathname: string): { bucket: string; key: string } | null => {
  if (!pathname.startsWith(PUBLIC_OBJECT_PATH_PREFIX)) return null;
  const rest = pathname.slice(PUBLIC_OBJECT_PATH_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
};

/**
 * No network: what would happen if this value were read, and why it would not.
 * The admin configuration surface uses this to census stored templates.
 */
export function templateImagePlan(value: string | null | undefined): TemplateImagePlan {
  if (typeof value !== 'string' || value.trim() === '') return { kind: 'refused', reason: 'empty' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { kind: 'refused', reason: 'not-a-url' };
  }
  if (!isAllowedRemoteImageUrl(value)) {
    const object = bucketOf(parsed.pathname);
    const sameOrigin = Boolean(configuredSupabaseOrigin()) && parsed.origin === configuredSupabaseOrigin();
    if (sameOrigin && object && !(TEMPLATE_STORAGE_BUCKETS as readonly string[]).includes(object.bucket)) {
      return { kind: 'refused', reason: 'bucket-not-allowed' };
    }
    return { kind: 'refused', reason: 'host-not-allowed' };
  }
  const object = bucketOf(parsed.pathname);
  if (object && parsed.origin === configuredSupabaseOrigin()) return { kind: 'storage', ...object };
  return { kind: 'remote' };
}

export async function readTemplateImage(value: string | null | undefined): Promise<TemplateImageRead> {
  const plan = templateImagePlan(value);
  if (plan.kind === 'refused') return { ok: false, reason: plan.reason };

  let response: Response;
  try {
    response = await fetch(value as string, { cache: 'no-store', redirect: 'follow' });
  } catch (err) {
    console.warn(`[template-image] fetch threw: ${err instanceof Error ? err.message : err}`);
    return { ok: false, reason: 'not-fetchable' };
  }
  if (!response.ok) return { ok: false, reason: 'http-status', status: response.status };
  // `follow` means the guard ran against the URL we asked for, not the one we
  // landed on; re-checking the final URL is what stops a stored row from being a
  // redirect primitive into a host this app has decided not to trust.
  if (response.url && !isAllowedRemoteImageUrl(response.url)) return { ok: false, reason: 'redirected-off-origin' };
  return { ok: true, bytes: Buffer.from(await response.arrayBuffer()) };
}
```

- [x] **Step 4: Run** `npx vitest run tests/unit/media/template-image.test.ts` → pass.
- [x] **Step 5: Commit** `git add -A src/lib/media/template-image.ts tests/unit/media/template-image.test.ts && git commit -m "feat(contest-studio): read template bytes with a named failure reason"`.

## Task 3: Point the pipeline at it, and unmask the defect in the test

**Files:**
- Modify: `frontend-web/src/server/photo-jobs/runner.ts:255-265` (the two byte reads and the degrade record)
- Modify: `frontend-web/src/lib/rendering/imageCompositor.ts:122-133` (comment only — the guard it calls is now correct)
- Modify: `frontend-web/tests/unit/photo-jobs/blend/runner-blend.test.ts:39,56,180-281`
- Test: same file (no new file)

**Interfaces:**
- Consumes: `readTemplateImage` (Task 2).
- Produces: `render_params.blend.error` values of the form `the cutout bytes could not be read (<reason>)` / `the template bytes could not be read (<reason>)`, and a blend test whose template URL is one production config can emit.

- [x] **Step 1: Rewrite the masking fixtures.** In `runner-blend.test.ts` set `const TEMPLATE_URL = 'http://127.0.0.1:54321/storage/v1/object/public/contest-templates/templates/c2eca087/3491eee5.png'` (the shape the dev DB holds today), set `process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'` in `beforeAll`, mock `@/src/lib/media/template-image` alongside `readAssetBytes`, and replace the `provider_url === 'https://cdn.test/template.png'` branch with `readTemplateImage` returning `template-png-bytes`.
- [x] **Step 2: Add the regression case the mock was hiding**, asserting the two things that were impossible before: the URL the console writes reaches `applied: true`, and a refused URL names the reason.

```ts
it('blends a template stored by the admin console, not only a CDN one', async () => {
  // The P2 suite mocked `https://cdn.test/template.png`, a host no config in this
  // repo can emit. This is the URL `contest-templates/route.ts:227` actually
  // writes, and the blend used to degrade on every one of them.
  deps.resolveActiveTemplateForContest.mockResolvedValue(template({ templateUrl: TEMPLATE_URL }));
  expect(await runPhotoJob(job as never)).toBe('ready');
  expect(deps.blendSubject).toHaveBeenCalledTimes(1);
  expect(deps.readTemplateImage).toHaveBeenCalledWith(TEMPLATE_URL);
  expect(finalCall().renderParams.blend.applied).toBe(true);
});

it('names which byte read failed, and why', async () => {
  deps.resolveActiveTemplateForContest.mockResolvedValue(template({ templateUrl: 'https://evil.test/t.png' }));
  deps.readTemplateImage.mockResolvedValue({ ok: false, reason: 'host-not-allowed' });
  expect(await runPhotoJob(job as never)).toBe('ready');
  expect(finalCall().renderParams.blend).toEqual({
    applied: false, preset: 'natural', error: 'the template bytes could not be read (host-not-allowed)',
  });
});
```

- [x] **Step 3: Run to red** — `npx vitest run tests/unit/photo-jobs/blend/runner-blend.test.ts` must fail on `readTemplateImage is not a function of the mock` / the `applied:true` expectation, proving the runner still reads templates through the old path.
- [x] **Step 4: Implement in the runner.**

```ts
  // Two reads, one each. The cutout comes from the vendor (a signed CDN URL, so
  // `readAssetBytes`); the frame comes from our own bucket, whose URL is only
  // fetchable because Task 1 taught the guard about it, and through
  // `readTemplateImage` so a failure can say which shape went wrong.
  const [subjectPng, templateRead] = await Promise.all([
    readAssetBytes({ storage_key: null, provider_url: args.cutoutUrl }),
    readTemplateImage(template.templateUrl),
  ]);
  const templatePng = templateRead.ok ? templateRead.bytes : null;

  if (!subjectPng || !templatePng) {
    const reason = !subjectPng ? 'the cutout bytes could not be read'
      : `the template bytes could not be read (${(templateRead as { reason: string }).reason})`;
    return { input: paste(), record: { applied: false, preset: params.preset, error: reason } };
  }
```

Update the two existing assertions the change invalidates: the read-call list (line ~259) now expects only the cutout via `readAssetBytes`, and the byte-unreadable case (~279) now expects the named reason. Do not touch the `preset: 'off'` case — §14.11 still requires `readAssetBytes` to be called exactly once there, and the new code keeps that true because the template read happens after the `isBlendDisabled` short-circuit.
- [x] **Step 5: Run** the whole `photo-jobs` directory: `npx vitest run tests/unit/photo-jobs` → all pass. Then `npm run type-check`.
- [x] **Step 6: Commit** `git commit -am "fix(contest-studio): composite Supabase-hosted templates, and test the URL shape the console writes"`.

## Task 4: Live proof against a stored row

**Files:**
- Create: `frontend-web/tests/unit/photo-jobs/live/template-blend-live.test.ts`

**Interfaces:**
- Consumes: `readTemplateImage`, `templateImagePlan`, `resolveBlendParams`, `blendSubject`, `compositeImage`, and `figurePng` from `tests/unit/photo-jobs/blend/fixtures.ts`.
- Produces: a printed verdict array `[{ templateId, url, plan, bytes, applied, decisions, placement, composite }]` and one composited file per blended row under `$TMPDIR/spotlight-live-blend/`.

**Correction found while executing (why not `scripts/qa/*.ts`).** There is no `scripts/qa/` directory in this repo — `frontend-web/scripts/` holds only `contract-check.mjs` — and no TS loader: `node_modules/.bin` has `vitest` but neither `tsx` nor `ts-node`. `node --experimental-strip-types` therefore cannot run a harness at all, because every module it would import (`src/lib/media/template-image.ts`, `src/lib/rendering/blend/index.ts`, `imageCompositor.ts`) reaches its neighbours through the `@/src` alias, which only vitest's `resolve.alias` maps. So the harness is a gated vitest file. `tests/unit/photo-jobs/live/` is inside `vitest.config.ts`'s `include` (`tests/unit/**/*.test.ts`), which is why the file must carry `describe.skipIf(!process.env.LIVE_TEMPLATE_PROOF)`: CI's unit lane has no database and no storage service, and a live assertion that "passes" in a container that cannot reach either is worse than no assertion. Written composites go to `$TMPDIR/spotlight-live-blend/` rather than `outputs/` because `outputs/` is not in `.gitignore`.

- [x] **Step 1: Write the harness.** It reads the three real rows over the Storage REST path with the service key, and for each one prints the plan and the byte length, then runs the engine and compositor over the P2 figure fixture and reports `applied`. Dev has **zero `template_slots` rows** (`select count(*) from template_slots` → `0`), so the slot is synthesized from the row's own `width`/`height` rather than inserting a row into the shared database; that is the state P3's studio (Tasks 9 and 11) exists to end. `storePhoto` is not exercised — dropping objects into the shared dev bucket to prove a URL is readable would leave state behind.

Run command:

```bash
cd frontend-web
set -a; . ../../../frontend-web/.env.local; set +a   # dev Supabase URL + service key
LIVE_TEMPLATE_PROOF=1 npx vitest run tests/unit/photo-jobs/live
```

- [x] **Step 2: Run it.** Measured on 2026-11-28, vitest 5.1.0, exit 0, 1 passed in 19.2 s. All three stored rows reached `applied: true`:

| stored object | bytes read | `mode` | placement target | composite written |
|---|---|---|---|---|
| `…/templates/c2eca087…/3491eee5….png` | 2,849,495 | declared `auto` → used `background` | 279×670 at (401, 281) | `d842480f….jpg` 1080×1080, 112,411 B |
| `…/templates/895eae80…/c231c0c0….png` | 2,849,495 | `auto` → `background` | 279×670 at (401, 281) | `1e788b8f….jpg` 1080×1080, 112,411 B |
| `…/templates/103d2e4e…/f5743aaf….jpg` | 165,840 | `auto` → `background` | 279×670 at (401, 281) | `57c3d369….jpg` 1080×1080, 198,174 B |

Each verdict also carries `edge.featherPx: 1`, `light.gain: 0.92` with `temperature {r:1.018, b:0.982}` and `contrast 1.027` recorded as clamped, `shadow.layers: 2`, `faceProtected.on: true` at strength 0.92, `jpegQuality: 90`. Every URL planned as `{kind:'storage', bucket:'contest-templates', key:'templates/…'}`, and the last assertion re-points `NEXT_PUBLIC_SUPABASE_URL` at `https://other-project.supabase.co` and gets `{ok:false, reason:'host-not-allowed'}` for the identical stored URL — so the trusted origin is demonstrably the deployment's, not the row's.

- [x] **Step 3: Record restarts.** Nothing was rebuilt and no server was restarted: the harness imports the modules from source and `configuredSupabaseOrigin()` reads `process.env.NEXT_PUBLIC_SUPABASE_URL` at call time, so no cache sits between the config and the check. **No new environment variable is needed anywhere** — dev resolves to `http://127.0.0.1:54321` and production already sets `NEXT_PUBLIC_SUPABASE_URL` to `https://nmseefdlliejmdbxytej.supabase.co` (proved from the shipped `frontend-web` chunks), which is the origin the console's `getPublicUrl()` writes. Nothing was written to production.

Full-suite census, for the PR record: two `npx vitest run` passes over this tree gave 12 and 9 failing tests, of which 10 and 7 were `Test timed out in 5000ms`, and the failing *set* differed between runs — the signature of CPU contention (three Qoder sessions share this laptop). The failures that reproduce in isolation — `certificate-artifact`, `beat-download-origin`, `contest-admin-schedule-route` ×2, `wallet/bank` ×2 — reproduce **verbatim at base `7c7ead9e8`** with the same file list: 6 failed / 123 passed at base against 6 failed / 152 passed here, the 29-test difference being Tasks 1–4's new tests. No regression was introduced, and the live file reports `1 skipped` when `LIVE_TEMPLATE_PROOF` is unset.

- [x] **Step 4: Commit** `git add frontend-web/tests/unit/photo-jobs/live/template-blend-live.test.ts && git commit -m "test(contest-studio): prove a console-written template row composites live"`.

## Task 5: `compositeWithBlend` — one render path for the runner and the preview

**Files:**
- Create: `frontend-web/src/lib/rendering/blend/composite.ts`
- Modify: `frontend-web/src/server/photo-jobs/runner.ts` (`chooseRender` returns a discriminated render; `BlendOverrides` moves out)
- Test: `frontend-web/tests/unit/photo-jobs/blend/composite.test.ts`

**Interfaces:**
- Consumes: `blendSubject`, `compositeImage`, `isBlendDisabled`, `SlotConfig`, `CanvasSize`, `BlendParams`.
- Produces:
  - `export interface BlendOverrides { xOffset?: number; yOffset?: number; scale?: number }`
  - `export interface BlendCompositingArgs { templatePng: Buffer; canvas: CanvasSize; slot: SlotConfig; foregroundSlots?: SlotConfig[]; subjectPng: Buffer; params: BlendParams; photoMode?: string; overrides?: BlendOverrides; metrics?: SubjectMetrics }`
  - `export interface BlendCompositingResult extends CompositorResult { decisions: Record<string, unknown> }`
  - `export async function compositeWithBlend(args: BlendCompositingArgs): Promise<BlendCompositingResult>`

- [ ] **Step 1: Failing test** with real sharp inputs (a 60×80 template, a 40×60 alpha subject): assert (a) `decisions.applied === true`, (b) the compositor receives `underlays`/`faceSafe`/`jpegQuality` and `templateBytes` with no `templateUrl`, (c) with a slot whose `face_protect` is false `decisions.faceProtected.on` is false, (d) the output buffer byte-length differs from the unblended `compositeImage` call over the same inputs (the blend changed pixels), and (e) calling it with `resolveBlendParams('off')` returns decisions `applied:false` and a buffer byte-identical to the direct P1-shaped `compositeImage({ templateBytes, slots:[{...slot, photo_bytes: subject}] })` call.
- [ ] **Step 2: Run to red** (`Cannot find module`).
- [ ] **Step 3: Implement** — the body is exactly the input construction currently inlined at `runner.ts:277-293`, plus the declined-path input, plus `compositeImage`:

```ts
export async function compositeWithBlend(args: BlendCompositingArgs): Promise<BlendCompositingResult> {
  const blend = await blendSubject({
    subjectPng: args.subjectPng,
    templatePng: args.templatePng,
    canvas: args.canvas,
    slot: args.slot,
    params: args.params,
    metrics: args.metrics,
    photoMode: args.photoMode,
    overrides: args.overrides,
  });
  const foreground = args.foregroundSlots ?? [];
  const input: CompositorInput = blend.placement
    ? {
        // No `templateUrl` beside these bytes: §14.11's "the read is paid for"
        // is only true if nothing downstream fetches the same URL a second time.
        templateBytes: args.templatePng,
        templateWidth: args.canvas.width,
        templateHeight: args.canvas.height,
        slots: [{ ...args.slot, photo_bytes: blend.subjectPng, placement: blend.placement }, ...foreground],
        underlays: blend.underlays,
        faceSafe: blend.faceSafe,
        jpegQuality: blend.jpegQuality,
      }
    : {
        templateBytes: args.templatePng,
        templateWidth: args.canvas.width,
        templateHeight: args.canvas.height,
        slots: [{ ...args.slot, photo_bytes: blend.subjectPng }, ...foreground],
      };
  return { ...(await compositeImage(input)), decisions: blend.decisions };
}
```

- [ ] **Step 4: Refactor the runner** so `chooseRender` answers `{ kind: 'paste'; input: CompositorInput; record }` or `{ kind: 'blend'; args: BlendCompositingArgs }`, and `runPhotoJob` composes inside its existing try:

```ts
  let composited: { key: string; buffer: Buffer; mimeType: string; width: number; height: number };
  let blendRecord: Record<string, unknown>;
  try {
    if (render.kind === 'blend') {
      const r = await compositeWithBlend(render.args);
      blendRecord = r.decisions;
      composited = { buffer: r.buffer, mimeType: r.mimeType, width: r.width, height: r.height, key: await storePhoto(r.buffer, r.mimeType, 'composited') };
    } else {
      blendRecord = render.record;
      const r = await compositeImage(render.input);
      composited = { ...r, key: await storePhoto(r.buffer, r.mimeType, 'composited') };
    }
  } catch (err) {
    return fail(job, `Compositing failed: ${messageOf(err)}`);
  }
```
- [ ] **Step 5: Run** `npx vitest run tests/unit/photo-jobs tests/unit/rendering && npm run type-check` → all pass, with `runner-blend.test.ts`'s existing assertions about `compositeImage`'s argument shape unchanged (vitest mocks are module-level, so `composite.ts` sees them too).
- [ ] **Step 6: Commit** `git commit -am "refactor(contest-studio): one blended-composite path for the runner and the studio preview"`.

## Task 6: Migration `20272300000000` — the columns and four RPCs

**Files:**
- Create: `supabase/migrations/20272300000000_contest_template_studio.sql`
- Test: `frontend-web/tests/unit/photo-jobs/template-studio-migration.test.ts` (text assertions on the migration, the house pattern for SQL invariants) + the scratch replay in Step 4.

**Interfaces:**
- Produces RPCs `public.duplicate_contest_template(uuid, uuid) → jsonb`, `public.publish_contest_template(uuid, uuid) → jsonb`, `public.archive_contest_template(uuid, uuid) → jsonb`, `public.contest_template_versions(uuid) → jsonb`; columns `contest_templates.published_at timestamptz`, `contest_templates.published_by uuid`.

- [ ] **Step 1: Write the migration.** `add column if not exists` for the two columns (`published_by uuid references public.user_profiles(id) on delete set null`), a partial index on `parent_template_id`, then the four functions per the preamble in Global Constraints. `publish_contest_template` refuses (`22023`) a non-draft status, a NULL `connect_contest_id`, and a template with no `contestant` slot; it archives **every** active row of that contest in the same transaction (D2 — enforced in the transaction, not by an index), then inserts a new active row copying `template_url, thumbnail_url, file_format, width, height, aspect_ratio, is_reusable, contest_id, connect_contest_id, photo_mode, blend_preset, blend_settings` with `version = coalesce(prev.version,0)+1`, `parent_template_id = prev.id`, `published_at = now()`, `published_by = p_actor_id`, and copies `template_slots` (all 18 authoring columns) and `template_text_overlays` (label, field_type, content, x, y, font_size, font_weight, color, z_index) from the draft. `contest_template_versions` walks `parent_template_id` up to the root with `with recursive`, then down with a `depth < 100` guard, and returns `jsonb_agg(... order by version)`.
- [ ] **Step 2: Unit-test the text invariants** that no other lane would catch: the four `revoke all … from public, anon, authenticated` lines equal the four function names; every function has `security definer` and `set search_path = public, pg_temp`; the file contains no `drop ` / `delete from ` statement; `publish_contest_template` contains both `status = 'archived'` and `slot_type = 'contestant'`. Read the file with `readFileSync(new URL('../../../../supabase/migrations/…', import.meta.url))`.
- [ ] **Step 3: Run** `npx vitest run tests/unit/photo-jobs/template-studio-migration.test.ts` → pass.
- [ ] **Step 4: Replay the whole chain into a scratch database** — never the shared dev DB. Use the DSN from the main checkout's `backend/.env`, derive the scratch DSN by substitution (so no credential is typed or printed), create, replay, probe, drop:

```bash
MAIN=/Users/paymax/Documents/spotlight/main
URL=$(grep -m1 -E '^(export )?DATABASE_URL' "$MAIN/backend/.env" | sed -E 's/^[^=]+=//; s/^"//; s/"$//')
psql "$URL" -q -v ON_ERROR_STOP=1 -c "create database p3_chain_replay"
REPLAY=$(printf '%s' "$URL" | sed -E 's#/(postgres|template1)([?]|$)#/p3_chain_replay\2#')
psql "$REPLAY" -q -v ON_ERROR_STOP=1 -f scripts/ci/supabase-compat-prelude.sql
for f in $(ls supabase/migrations/*.sql | sort); do
  psql "$REPLAY" -q -v ON_ERROR_STOP=1 -f "$f" || { echo "REPLAY FAILED AT $f"; break; }
done
psql "$REPLAY" -qAt -c "select column_name from information_schema.columns where table_name='contest_templates' and column_name in ('published_at','published_by')"
psql "$REPLAY" -qAt -c "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like '%contest_template%' order by 1"
```
Expected: the chain reaches `20272300000000` with no error, two columns, four function names.
- [ ] **Step 5: Also run the version gate** `bash scripts/ci/check-migration-versions.sh` → pass.
- [ ] **Step 6: Commit** `git add supabase/migrations/20272300000000_contest_template_studio.sql frontend-web/tests/unit/photo-jobs/template-studio-migration.test.ts && git commit -m "feat(contest-studio): publish/duplicate/archive/version RPCs"`.

## Task 7: Live-DB proofs of the lifecycle invariants

**Files:**
- Create: `backend/tests/voting/template_studio_live_db_test.go` (`package voting_test`, `TestLiveDB_TemplateStudio*`)

**Interfaces:**
- Consumes: `votingPool(t)`, `newContest(t, ctx, pool, contestOpts{})`, the four RPCs from Task 6.
- Produces: no production API — this is the only lane that executes the SQL.

- [ ] **Step 1: Write the tests**, each seeding a draft template + slots with `uuid.NewString()` ids and cleaning up in `t.Cleanup` (slots before template; `template_text_overlays` too):
  1. publish a draft with a contestant slot → one active row, `version = 1`, the draft stays `draft`, slots copied;
  2. publish a second draft for the same contest → the first published row is `archived`, the new one is `version = 2` with `parent_template_id` = row 1, and exactly one active row remains;
  3. publish a draft with no contestant slot → `*pgconn.PgError` with `Code == "22023"`;
  4. publish a template whose `connect_contest_id` is NULL → same code;
  5. `duplicate_contest_template` copies slot count and the four P2 slot columns;
  6. `contest_template_versions` returns the lineage root-to-tip in version order, length 2 after two publishes;
  7. `archive_contest_template` twice → second returns `{"changed": false}`.
- [ ] **Step 2: Run against the scratch DB from Task 6** (recreate it if dropped):

```bash
cd backend && TEST_DATABASE_URL="$REPLAY" go test ./tests/voting/ -run 'TestLiveDB_TemplateStudio' -count=1 -v 2>&1 | tail -30
```
Expected: every test `--- PASS`, and `grep -c '^=== RUN   TestLiveDB_TemplateStudio'` equals the number of test functions (the canary the live-DB lane greps for).
- [ ] **Step 3: `go vet ./tests/voting/`** then commit `git add backend/tests/voting/template_studio_live_db_test.go && git commit -m "test(contest-studio): live proofs for publish/duplicate/archive/version invariants"`.

## Task 8: Authoring layer and studio fields on create/PATCH

**Files:**
- Create: `frontend-web/src/server/template-studio/authoring.ts`
- Modify: `frontend-web/app/api/admin/voting/contest-templates/_shared.ts`, `…/route.ts` (POST), `…/[templateId]/route.ts` (PATCH)
- Test: `frontend-web/tests/unit/voting/template-studio-authoring.test.ts`, extend `tests/unit/voting/contest-templates-admin-api.test.ts`

**Interfaces:**
- Consumes: `BOUNDS`/`PRESETS` from `blend/params.ts` (export both consts in this task; keep their contents identical), `resolveBlendParams`.
- Produces:
  - `export const PHOTO_MODES = ['auto','background','photo_area'] as const`
  - `export type FieldVerdict = { ok: true; value: unknown } | { ok: false; code: string; error: string }`
  - `export function validatePhotoMode(raw: unknown): FieldVerdict`
  - `export function validateBlendPreset(raw: unknown): FieldVerdict`
  - `export function validateBlendSettings(raw: unknown): { ok: true; value: Record<string, unknown>; clamped: string[] } | { ok: false; code: string; error: string }`
  - `export function effectiveBlendParams(preset: unknown, settings: unknown): BlendParams`
  - `export function isEditableStatus(status: string): boolean`
  - `export function uuidOr(value: unknown): string | null`
  - in `_shared.ts`: `export function studioRpcFailure(prefix: string, error: { code?: string; message?: string }): Response`

- [ ] **Step 1: Failing unit tests** for the validator: unknown key → `blend_setting_unknown` naming the key; non-number → `blend_setting_not_a_number`; `shadow: 'loud'` → `blend_setting_invalid`; `featherPx: 99` → clamped with `clamped: ['featherPx']`; a JSON string is parsed, an array or `null` is accepted as "no overrides"; `photoMode: 'blur'` → `photo_mode_invalid`; preset outside the four → `blend_preset_invalid`; `isEditableStatus('active')` false and `('draft')` true.
- [ ] **Step 2: Run to red**, implement, run to green.
- [ ] **Step 3: Route tests, then routes.** In `contest-templates-admin-api.test.ts` add: POST with `blendPreset=studio` + `blendSettings={"featherPx":2}` stores both and answers `template.blendPreset === 'studio'`; POST with `blendSettings='{'featherPx':"two"}'` → 400 `blend_setting_not_a_number` and **no storage upload** (assert the fake client's `upload` was not called — the ordering rule the create route already documents); PATCH of `photoMode` on a draft → 200 and the row carries it; PATCH of `photoMode` on an `active` row → 409 `template_is_published`; PATCH `status:'active'` on a draft → calls `rpc('publish_contest_template', { p_draft_id, p_actor_id })` and returns `{ success: true, template }` from the published row, and the legacy "no contestant slot" refusal now comes from the RPC's `22023` mapped through `studioRpcFailure` → 400.
- [ ] **Step 4: `mapTemplateRow` gains** `photoMode`, `blendPreset`, `blendSettings`, `publishedAt`, `publishedBy` (from `published_at`/`published_by`).
- [ ] **Step 5: Run** `npx vitest run tests/unit/voting && npm run type-check` → pass. Commit `feat(contest-studio): studio fields on create and patch, published rows read-only`.

## Task 9: Slot art round-trips through PUT

**Files:**
- Modify: `frontend-web/app/api/admin/voting/contest-templates/_shared.ts` (`mapSlotRow`), `…/[templateId]/slots/route.ts`
- Test: extend `tests/unit/voting/contest-templates-admin-api.test.ts`

**Interfaces:**
- Consumes: `templateImagePlan` (Task 2) to validate `imageUrl`.
- Produces: `SlotInput` gains `imageUrl?: string | null; anchor?: string; bleed?: boolean; faceProtect?: boolean`; `mapSlotRow` returns `imageUrl, anchor, bleed, faceProtect`.

- [ ] **Step 1: Failing tests**: PUT carrying the four fields inserts them (`insert` payload assertion); omitted fields insert the column defaults `anchor:'auto'`, `bleed:false`, `face_protect:true`, `image_url:null` — the replace semantics of PUT, stated rather than hidden; `imageUrl: 'https://evil.test/x.png'` → 400 `slot_image_not_readable`; **the drop guard**: when an existing slot row has a non-null `image_url` that no slot in the payload repeats, PUT answers 400 `slot_art_would_be_dropped` naming it, and `delete` was never called.
- [ ] **Step 2: Implement** (validate → read existing rows → drop guard → delete → insert). Keep the pre-existing "active template must keep a contestant slot" guard untouched; the studio fields are draft-gated by `isEditableStatus`, but only when the payload actually sets one of the four (so the shipped console keeps working while it does not know them yet).
- [ ] **Step 3: Run** `npx vitest run tests/unit/voting && npm run type-check` → pass. Commit `feat(contest-studio): slots carry their own art`.

## Task 10: Preview — sample portrait in, composited PNG out

**Files:**
- Create: `frontend-web/src/server/template-studio/preview.ts`, `frontend-web/app/api/admin/voting/contest-templates/[templateId]/preview/route.ts`
- Modify: `frontend-web/src/server/registration/template-resolver.ts` (export `toSlot`)
- Test: `frontend-web/tests/unit/voting/template-studio-preview.test.ts`

**Interfaces:**
- Consumes: `readTemplateImage`, `compositeWithBlend`, `resolveBlendParams`, `validateBlendSettings/validateBlendPreset/validatePhotoMode`, `toSlot`.
- Produces: `export async function buildPreview(input: PreviewInput): Promise<PreviewResult>` with
  `type PreviewResult = { ok: true; buffer: Buffer; mimeType: string; decisions: Record<string, unknown> } | { ok: false; status: number; code: string; error: string }`, refusal codes `sample_required`, `sample_needs_cutout`, `sample_unreadable`, `template_not_found`, `no_contestant_slot`, `canvas_too_large`, `template_bytes_unreadable:<reason>`, and the route's headers `X-Blend-Applied`, `X-Render-Decisions`.

- [ ] **Step 1: Failing tests** over `buildPreview` with stubbed reads: an opaque sample → `415 sample_needs_cutout` (never a contestant's photograph — spec D4); a sample with alpha → `ok:true`, `decisions.applied === true`, PNG buffer > 0 bytes; `canvas_too_large` for a 5000×5000 template before any read; `template_bytes_unreadable:host-not-allowed` when the plan refuses.
- [ ] **Step 2: Implement** `buildPreview`: `sharp(sample).metadata()` → `hasAlpha` decides, `templateImagePlan`/`readTemplateImage` for the frame, `compositeWithBlend` for the pixels, and it writes nothing (D3 — no asset row, no storage object, no job).
- [ ] **Step 3: Route**: `assertAdminPermission(request,'votes:manage')`, `formData()` guarded by `classifyFormDataParseFailure` (the create route's pattern), fields `sample`, `photoMode`, `blendPreset`, `blendSettings`, `xOffset`, `yOffset`, `scale`; `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'`; response `new NextResponse(Buffer.from(result.buffer), { status: 200, headers: { 'Content-Type': result.mimeType, 'Cache-Control': 'no-store', 'X-Blend-Applied': String(result.decisions.applied === true), 'X-Render-Decisions': encodeURIComponent(JSON.stringify(result.decisions)) } })`.
- [ ] **Step 4: Run** `npx vitest run tests/unit/voting/template-studio-preview.test.ts && npm run type-check` → pass. Commit `feat(contest-studio): synchronous studio preview render`.

## Task 11: Lifecycle and art-upload routes

**Files:**
- Create: `…/[templateId]/{duplicate,publish,archive,versions,slot-art}/route.ts`
- Test: `frontend-web/tests/unit/voting/template-studio-lifecycle.test.ts`

**Interfaces:**
- Consumes: `studioRpcFailure`, `uuidOr`, the four RPCs, `ALLOWED_IMAGE_MIME_TYPES`/`MAX_CONTEST_TEMPLATE_UPLOAD_BYTES`/`describeStorageFailure`/`EXT_BY_MIME` equivalents from the create route (move `EXT_BY_MIME` and `ACCEPTED_LABEL` into `_shared.ts` so the two upload paths cannot drift).
- Produces: `POST duplicate` → 201 `{ success, templateId, version }`; `POST publish` → 200 `{ success, template, archivedIds }`; `POST archive` → 200 `{ success, changed }`; `GET versions` → 200 `{ success, versions }`; `POST slot-art` (multipart `file`) → 201 `{ success, imageUrl }` with key `slots/<templateId>/<uuid>.<ext>` in the same bucket.

- [ ] **Step 1: Failing tests**: each route 403s before touching Supabase (the guard runs first, same as today); `publish` passes `p_actor_id: null` when the caller's `actorId` is `'api-key'` (the precedent at `route.ts:237`) and a real uuid otherwise; an RPC error with `does not exist` → 404 `template_not_found`; `22023` → 400 carrying the RPC's sentence; `slot-art` refuses an oversized file with 413 `file_too_large` before uploading and refuses an unknown mime with 400 `file_type_unsupported`.
- [ ] **Step 2: Implement**, then run `npx vitest run tests/unit/voting && npm run type-check`. Commit `feat(contest-studio): duplicate/publish/archive/versions/slot-art routes`.

## Task 12: Configuration surface tells the truth about stored templates

**Files:**
- Modify: `frontend-web/app/api/admin/photo-config-status/route.ts`
- Test: extend `frontend-web/tests/unit/photo-jobs/routes.test.ts` (add `vi.mock('@/lib/supabase/server')` — the route gains its first Supabase read)

**Interfaces:**
- Consumes: `templateImagePlan` (no network), `BOUNDS`/`PRESETS`.
- Produces: response gains `templates: { activeCount, readableCount, refused: [{ id, name, reason, host }] }` and `blend: { presets: string[], bounds: Record<string, [number, number]> }`, plus a blocker sentence when `refused.length > 0`.

- [ ] **Step 1: Failing test**: one active template with a `contest-templates` object URL → `readableCount 1`, no template blocker; one with `https://evil.test/x.png` → `refused[0].reason === 'host-not-allowed'` and a blocker naming the count; `blend.bounds.featherPx` equals `[0, 2]` verbatim from `params.ts` (this is the parity test that keeps the console's slider bounds honest — no cross-package import needed).
- [ ] **Step 2: Implement, run, commit** `feat(contest-studio): census stored templates and publish blend bounds`.

## Task 13: The console studio

**Files:**
- Modify: `frontend-admin/src/services/contestTemplatesService.ts`
- Create: `frontend-admin/app/admin/voting/templates/TemplateStudio.tsx`
- Modify: `frontend-admin/app/admin/voting/templates/page.tsx`
- Test: `frontend-admin/tests/admin/contests/template-studio.test.tsx`, `…/template-studio-request.test.ts`

**Interfaces:**
- Consumes: the routes from Tasks 8-12.
- Produces: service adds `duplicateContestTemplate`, `publishContestTemplate`, `archiveContestTemplate`, `listContestTemplateVersions`, `uploadSlotArt`, `previewContestTemplate`, `getBlendConfig`; `TemplateSlot` gains `imageUrl/anchor/bleed/faceProtect`; `ContestTemplate` gains `photoMode/blendPreset/blendSettings/publishedAt`; `replaceTemplateSlots` payloads **always include the four art fields** (the route's defaults must never be reached by this client).

- [ ] **Step 1: Failing request test** asserting the PUT body from `replaceTemplateSlots` contains all four fields for every slot (this is what closes the silent-drop path that the replace semantics create).
- [ ] **Step 2: Failing component test** (jsdom + `@testing-library/react`): the panel renders one range input per `bounds` key with `min`/`max` from the fetched config; a `409 template_is_published` on save shows the server sentence; the preview button renders the returned object URL in an `<img>` and shows `blend applied`/`blend declined` from the header.
- [ ] **Step 3: Implement** the panel (preset select, photo-mode select, sliders from bounds, slot-art row with upload + anchor select + bleed/face-protect toggles, Publish/Duplicate/Archive/History buttons, preview pane), mount it in the existing row expansion of `page.tsx`, and keep the current numeric editor working unchanged.
- [ ] **Step 4: Run** `cd frontend-admin && npx vitest run tests/admin/contests && npm run type-check && npm run check:mock-flags` (with `NODE_ENV=production`, the CI form) → pass. Commit `feat(contest-studio): admin template studio panel`.

## Task 14: Sweep, push, stacked PR, census

- [ ] **Step 1:** `cd frontend-web && npx vitest run tests/unit 2>&1 | tail -20`, `npm run type-check`, `npm run lint`; `cd ../frontend-admin && npx vitest run && npm run type-check`; `cd ../backend && go build ./... && go vet ./tests/voting/`; `bash scripts/ci/check-migration-versions.sh`; `npx @redocly/cli@1 lint contracts/openapi.yaml --config redocly.yaml --max-problems=3000` if any contract file changed.
- [ ] **Step 2:** `git push -u origin feat/contest-template-studio`, then `gh pr create --base feat/contest-photo-blend-layer --title "feat(contest-studio): P3 admin template studio" --body-file <draft>` recording the measured numbers from Step 1 and Task 4's live output, and stating that no production env var is required.
- [ ] **Step 3:** `gh workflow run "CI — CLAUDE.md gates" --ref feat/contest-template-studio` (stacked heads are outside `ci.yml:76-77`'s `pull_request` scope) and read the census from `commits/<sha>/check-runs --paginate | sort | uniq -c`, using `python3 scripts/ci/required-checks.py --branch main` for the required-context names.
- [ ] **Step 4:** Report. **Do not merge.**

---

## Deferred by design (recorded in the PR body, not built here)

Drag-and-drop slot editing and text-overlay authoring move to P3b; `frontend-web/tests/integration/**` still has no CI lane, which is why the RPC proofs are Go tests; the CDN allowlist stays a closed literal list.
