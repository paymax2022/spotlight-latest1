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
  - `export interface BlendCompositingArgs { templatePng: Buffer; canvas: CanvasSize; slot: SlotConfig; foregroundSlots?: SlotConfig[]; subjectPng: Buffer; params: BlendParams; photoMode?: string; overrides?: BlendOverrides; metrics?: SubjectMetrics; fallback?: CompositorInput }`
  - `export interface BlendCompositingResult extends CompositorResult { decisions: Record<string, unknown> }`
  - `export async function compositeWithBlend(args: BlendCompositingArgs): Promise<BlendCompositingResult>`

- [x] **Step 1: Failing test** with real sharp inputs (a 400×400 `opaqueTemplate`, a `figurePng` subject at 200×300 — the plan said 60×80/40×60, which is too small for `measureSubject`'s fringe statistics to be meaningful, so the house fixtures' sizes are used): assert (a) `decisions.applied === true`, (b) the compositor receives `underlays`/`faceSafe`/`jpegQuality` and `templateBytes` with no `templateUrl`, (c) with a slot whose `face_protect` is false `decisions.faceProtected.on` is false, (d) the output buffer byte-length differs from the unblended `compositeImage` call over the same inputs (the blend changed pixels), and (e) calling it with `resolveBlendParams('off')` returns decisions `applied:false` and a buffer byte-identical to the direct P1-shaped `compositeImage({ templateBytes, slots:[{...slot, photo_bytes: subject}] })` call. Two cases were added beyond the plan: the §10 fallback (below) and throw-through-without-fallback.
- [x] **Step 2: Run to red** — `Error: Cannot find package '@/src/lib/rendering/blend/composite'` (vitest 5's wording for the missing module), 1 file failed.
- [x] **Step 3: Implement** — the body is the input construction that was inlined in `chooseRender`, plus the declined-path input, plus `compositeImage`. One deliberate addition beyond the plan's snippet, because §10's rule would otherwise have stayed duplicated in the runner and been absent from the preview: `BlendCompositingArgs` carries `fallback?: CompositorInput`, and the `blendSubject` call is wrapped so that **an engine which throws renders the caller's fallback and records `{ applied: false, preset, error }`** — with no `fallback` supplied the throw propagates (a caller that has nothing to fall back to must not silently ship an unblended portrait). The composite and store calls stay un-caught: those still end a job.

```ts
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function compositeWithBlend(args: BlendCompositingArgs): Promise<BlendCompositingResult> {
  const fallback = args.fallback;
  let blend: BlendOutput;
  try {
    blend = await blendSubject({
      subjectPng: args.subjectPng,
      templatePng: args.templatePng,
      canvas: args.canvas,
      slot: args.slot,
      params: args.params,
      metrics: args.metrics,
      photoMode: args.photoMode,
      overrides: args.overrides,
    });
  } catch (err) {
    if (!fallback) throw err;
    const degraded = await compositeImage(fallback);
    return { ...degraded, decisions: { applied: false, preset: args.params.preset, error: messageOf(err) } };
  }
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

Two import notes the snippet has to get right: `BlendOutput` is exported by
`blend/index.ts`, but `CanvasSize` is **not** (it lives in `blend/placement.ts`
and `index.ts` only imports it), and `tsc --noEmit` reports TS2459 rather than an
esbuild error, so the file transpiles and fails the type-check lane if you copy
both from the index.

- [x] **Step 4: Refactor the runner** so `chooseRender` answers a declared `type Render = { kind: 'paste'; input: CompositorInput; record } | { kind: 'blend'; args: BlendCompositingArgs }` and `runPhotoJob` composes inside its existing try. The blend arm supplies `fallback: paste()`, which is why the engine-throw case keeps its exact record `{ applied: false, preset: 'natural', error: 'median exploded' }` and still reaches `ready` with `compositeImage` called once. `BlendOverrides` is no longer declared in `runner.ts` — it is imported from the seam, so the two callers cannot drift the nudge keys.

```ts
  let composited: { key: string; buffer: Buffer; mimeType: string; width: number; height: number };
  let blendRecord: Record<string, unknown>;
  try {
    if (render.kind === 'blend') {
      const blended = await compositeWithBlend(render.args);
      blendRecord = blended.decisions;
      composited = { buffer: blended.buffer, mimeType: blended.mimeType, width: blended.width,
        height: blended.height, key: await storePhoto(blended.buffer, blended.mimeType, 'composited') };
    } else {
      blendRecord = render.record;
      const pasted = await compositeImage(render.input);
      composited = { ...pasted, key: await storePhoto(pasted.buffer, pasted.mimeType, 'composited') };
    }
  } catch (err) {
    return fail(job, `Compositing failed: ${messageOf(err)}`);
  }
```

- [x] **Step 5: Run** `npx vitest run tests/unit/photo-jobs tests/unit/rendering` and `npx tsc --noEmit -p tsconfig.json`.

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/photo-jobs tests/unit/rendering` | `vitest_exit=0` — `Test Files 20 passed \| 1 skipped (21)`, `Tests 176 passed \| 1 skipped (177)` |
| `npx vitest run --no-file-parallelism …/composite.test.ts …/runner-blend.test.ts …/runner.test.ts` | `exit=0` — `Tests 35 passed (35)` |
| `npx tsc --noEmit -p tsconfig.json` | `tsc_exit=0`, log 0 bytes |

`runner-blend.test.ts`'s assertions about `compositeImage`'s argument shape needed
no change and still pass (vitest mocks are module-level, so `composite.ts` sees
them too). One intermediate run of the parallel suite reported 1 failure in
`composite.test.ts` with no assertion diff — a `Test timed out in 5000ms` of the
known kind under three sessions on one laptop; the same file passes in isolation
(8/8, 5.9 s) and serially (35/35), so the number above is the settled one.

- [x] **Step 6: Commit** → `de1040743 refactor(contest-studio): one blended-composite path for the runner and the studio preview` (3 files, +374/−53).

## Task 6: Migration `20272300000000` — the columns and four RPCs

**Files:**
- Create: `supabase/migrations/20272300000000_contest_template_studio.sql`
- Test: `frontend-web/tests/unit/photo-jobs/template-studio-migration.test.ts` (text assertions on the migration, the house pattern for SQL invariants) + the scratch replay in Step 4.

**Interfaces:**
- Produces RPCs `public.duplicate_contest_template(uuid, uuid) → jsonb`, `public.publish_contest_template(uuid, uuid) → jsonb`, `public.archive_contest_template(uuid, uuid) → jsonb`, `public.contest_template_versions(uuid) → jsonb`; columns `contest_templates.published_at timestamptz`, `contest_templates.published_by uuid`.

- [x] **Step 1: Write the migration.** `add column if not exists` for the two columns (`published_by uuid references public.user_profiles(id) on delete set null`, both nullable), a partial index on `parent_template_id`, then the four functions per the preamble in Global Constraints.

  **Corrected before execution — the first draft of this step contradicted the approved spec, and the spec won.** It said `publish_contest_template` "inserts a new active row copying …" with `version = coalesce(prev.version,0)+1` and "refuses a non-draft status". Spec D1 says the opposite on all three points: a published row is immutable because its `id` is inside P1's job idempotency key (`job-store.ts:84-90`), so re-publishing different pixels under the same id would answer a re-render from the completed row of the OLD template; therefore **"publish" activates the draft it is handed and mints nothing**, `duplicate_contest_template` is the only id-minting path, and publishing an already-active row is legal (it is how an admin re-times a publication). What publish DOES refuse is the two states §4 names: `connect_contest_id is null` (no contest can ever resolve it — `template-resolver.ts:165`) and no `slot_type = 'contestant'` row (§10: the pipeline drops such a template with a warning).

  Shipped shapes: `duplicate_contest_template(uuid,uuid)` inserts the new draft (`'draft', v.version + 1, v.id, …, p_actor, null, null`) after reading the source `for share`, then copies **all 19** `template_slots` authoring columns (15 from `20260405700000:107-130` plus P2's `image_url, anchor, bleed, face_protect` — the plan's "18" was off by one, and `x/y` are copied too) listed explicitly rather than via `select s.*` so a future column fails loudly at replay instead of silently defaulting, and the 9 `template_text_overlays` columns; returns `{template_id, version, slot_count, overlay_count}`. `publish_contest_template(uuid,uuid)` does `for update`, then a data-modifying CTE `with archived as (update … set status='archived' where connect_contest_id = v.connect_contest_id and id <> p_template_id and status='active' returning id)` — D2 enforced in the transaction, never a partial unique index — then `set status='active', published_at = now(), published_by = p_actor` (no hand-written `updated_at`: `trg_contest_templates_updated_at` at `20260405700000:162` is a BEFORE UPDATE trigger on this table, which is why P1's job functions DO set it by hand and these three do not); returns `{template_id, version, archived_ids}`. `archive_contest_template(uuid,uuid)` returns `{changed:false}` when already archived, else flips `status` only — `published_at`/`published_by` stay, they are the versions panel's history — and does NOT store `p_actor`, because `contest_templates` has no `archived_by` column and §4's column list did not ask for one. `contest_template_versions(uuid)` is `stable`, walks `parent_template_id` up to the root and back down (the tip is not necessarily the row you were handed), guards BOTH recursions with `depth < 100` because the FK has no cycle protection, and returns `{chain:[…] order by version desc, created_at desc}`.
- [x] **Step 2: Unit-test the text invariants** that no other lane would catch: the four `revoke all … from public, anon, authenticated` lines equal the four function names **as a set**, every function body individually carries `security definer` and `set search_path = public, pg_temp`, no `drop`/`delete from`/`create unique index` anywhere in the file, and `publish_contest_template`'s own body still contains `status = 'archived'`, `id <> p_template_id` and `slot_type = 'contestant'`. Read with `readFileSync(fileURLToPath(new URL('../../../../supabase/migrations/…', import.meta.url)))` — **four** levels from `tests/unit/photo-jobs/`, not P2's five; the wrong depth is an ENOENT at import, not an assertion failure. Assertions are scoped per function body (`body()` slices `create or replace function public.<name>` → its closing `$$;`) because a file-wide grep lets one guarded function vouch for four. One trap this caught while being written: "no backfill UPDATE" must be tested against the DDL region only (`sql.slice(0, index of 'create or replace function')`), since publish's own `update public.contest_templates set …` is the point of the file.
- [x] **Step 3: Run** `npx vitest run tests/unit/photo-jobs/template-studio-migration.test.ts` → **`Test Files 1 passed (1)` / `Tests 11 passed (11)`**, exit 0.

  **Red-first note, stated rather than papered over:** the SQL was drafted before this file, so there is no pre-implementation red run. The predicate-capture evidence is a four-mutant proof instead (`/tmp/p3_task6_mutation.py`, file restored by sha256 `a814dfbd…`):

  | mutant | test that went red | others |
  | --- | --- | --- |
  | `DROP INDEX …` added before the partial index | `is additive only` | 10 passed |
  | one `revoke` renamed (`contest_template_versions_v2`) | `closes each rpc to anon and authenticated by name` | 10 passed |
  | `set search_path` removed from **one** body | `gives every function the definer preamble on its own declaration` | 10 passed |
  | `and id <> p_template_id` deleted | `publishes by archiving the contest s other actives in the same body (D2)` | 10 passed |

  Each turned exactly one assertion red — including mutant 3, which a file-wide grep would have missed, and mutant 2, which the `grant execute` test cannot see. Verdict `4/4 mutants caught, file restored`.
- [x] **Step 4: Replay the whole chain into a scratch database** — never the shared dev DB. Use the DSN from the main checkout's `backend/.env`, derive the scratch DSN by substitution (so no credential is typed or printed), create, replay, probe, drop:

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

Measured (`/tmp/p3_task6_replay.sh`, output kept out of the credential by printing only the
host shape `localhost:54322` and the dbname):

```
dsn_host_shape: localhost:54322      replay_db: p3_chain_replay
files_applied=762  failures=0        last_file=20272300000000_contest_template_studio.sql
columns probe:  published_at, published_by
function probe: archive_contest_template, contest_template_versions, duplicate_contest_template, publish_contest_template
acl probe:      all four → postgres=X/postgres|service_role=X/postgres
```

Two additions the plan did not ask for and both earned their place. The script refuses to
continue unless the `sed` substitution actually changed the dbname (`case "$REPLAY" in
*"$URL"*) exit 1`), because a silently un-substituted DSN would replay the whole chain —
including trigger and RLS edits — into the shared dev database. And the `proacl` probe is
what proves the ALTER-DEFAULT-PRIVILEGES reasoning in the SQL comment: no `anon=`/`authenticated=`
entry survives on any of the four functions.

The replay only proves the DDL parses — plpgsql compiles a body at first call — so each
function was also executed there with an id that cannot exist:

```
ERROR:  duplicate_contest_template: no contest template 549a633a-… to duplicate
ERROR:  publish_contest_template: no contest template 549a633a-… to publish
ERROR:  archive_contest_template: no contest template 549a633a-… to archive
 versions | {"chain": []}
```

and a `do $$ … exception when others … $$` block reported the SQLSTATE each one raises:
`22023` for all three mutators, which is the code Task 8's `studioRpcFailure` maps to a 400.
Two psql attempts failed before that worked and are worth recording as traps: `:id` created
by `\set id "'…'::uuid"` is an **identifier** substitution (it produced `column "'f97a1a23…'::uuid"
does not exist`), so the id has to be interpolated as a SQL literal; and `ON_ERROR_STOP=0`
makes a refusal run exit **0**, so the verdict has to come from the printed messages.

The scratch database is deliberately **not** dropped here: Task 7 runs against it (Step 2 of
that task). Drop it once Task 7 is green.
- [x] **Step 5: Also run the version gate** `bash scripts/ci/check-migration-versions.sh` → `migration version guard passed — 762 migrations, all versions unique.`, exit 0.
- [x] **Step 6: Commit** → `55596c2e0 feat(contest-studio): publish/duplicate/archive/version RPCs` (2 files, +452: the SQL +305, the test +147). Staged by path; the untracked `frontend-web/node_modules` and `frontend-admin/node_modules` symlinks stayed out of the index (`git diff --cached --name-only` verified before committing).

## Task 7: Live-DB proofs of the lifecycle invariants

**Files:**
- Create: `backend/tests/voting/template_studio_live_db_test.go` (`package voting_test`, `TestLiveDB_TemplateStudio*`)

**Interfaces:**
- Consumes: `votingPool(t)`, `newContest(t, ctx, pool, contestOpts{})`, the four RPCs from Task 6.
- Produces: no production API — this is the only lane that executes the SQL.

- [x] **Step 1: Write the tests**, each seeding a draft template + slots with `uuid.NewString()` ids and cleaning up in `t.Cleanup` (the template row, since slots and overlays cascade off it; registered AFTER `votingPool`'s cleanup so LIFO deletes before `pool.Close`).

  **Corrected before execution, same defect as Task 6 Step 1:** proofs 1 and 2 here said "publish a draft → the draft stays `draft`, slots copied" and "the new one is `version = 2` with `parent_template_id` = row 1" — that is the old insert-a-new-row design, which spec D1 rejects. Under D1 publishing changes the draft row in place, and only `duplicate` creates a version. The list the file actually implements:

  1. `PublishActivatesTheDraftInPlace` — the returned `template_id` IS the draft's id, `version` stays 1, `archived_ids` is empty, and the row reads back `status='active'` with `published_at` set and `published_by = p_actor`.
  2. `SecondPublishArchivesTheFirst` — publishing a second draft of the same contest returns the first id in `archived_ids`, `count(status='active') = 1`, and the archived row still has `published_at` (history, not a flag).
  3. `RepublishingTheLiveRowArchivesNothing` — added *because of a surviving mutant*, see Step 2b: the already-active row reports `archived_ids = []`, stays `active`, keeps one active row, and its `published_at` moves.
  4. `PublishRefusesAMissingContestantSlot` — `*pgconn.PgError` with `Code == "22023"` whose message names "contestant slot", and the refusal activates nothing (`status` still `draft`, zero active rows).
  5. `PublishRefusesAnUnlinkedTemplate` — same code, message names "connect contest".
  6. `DuplicateMintsTheNextVersionAndCopiesAuthoring` — new id ≠ source, `version = 2`, `parent_template_id` = source, `created_by` = actor, `published_at` NULL, `slot_count`/`overlay_count` = 1/1, and P2's four slot columns copied verbatim (`image_url`, `anchor='top'`, `bleed=true`, `face_protect=false` — the last one matters because `face_protect` defaults to **true**, so a copy that silently fell back to the default would pass a weaker test); the source row is untouched.
  7. `VersionsReturnsTheLineageNewestFirst` — asked from the ORIGINAL row (which is why the function walks up before it walks down), chain length 2, versions `2` then `1`, statuses `active` then `archived`, `published_at` key present.
  8. `ArchiveIsIdempotent` — first press `changed=true`, second `changed=false`, `published_at`/`published_by` still set, zero active rows.
- [x] **Step 2: Run against the scratch DB from Task 6** (recreate it if dropped):

```bash
cd backend && TEST_DATABASE_URL="$REPLAY" go test ./tests/voting/ -run 'TestLiveDB_TemplateStudio' -count=1 -v 2>&1 | tail -30
```

Measured (log at `/tmp/p3_task7_run.log`, ANSI-stripped): `grep -c '^=== RUN   TestLiveDB_TemplateStudio'` = **8**, `grep -c '^--- PASS'` = **8**, `grep -cE '^(--- FAIL|FAIL)'` = **0**, `ok spotlight/backend/tests/voting 11.129s`. `go vet ./tests/voting/` exit 0; `gofmt -l tests/voting/` empty; `bash scripts/ci/check-live-db-gate.sh` → `live-DB gate guard passed — no test reads DATABASE_URL.`

**Step 2b: the behaviour mutation proof, which is why this task is not just a passing suite.** Every body was mutated *in the scratch database* (`/tmp/p3_task7_mutation.py` applies a perturbed copy of the migration with `create or replace`, then restores by replaying the pristine file) and each suite run was expected to go red:

| mutant | intended victim | result |
| --- | --- | --- |
| delete `and id <> p_template_id` | `SecondPublishArchivesTheFirst` | **PASS — survived** |
| publish's slot guard becomes `if false and not exists (…)` | `PublishRefusesAMissingContestantSlot` | FAIL (caught) |
| duplicate writes `v.version` instead of `v.version + 1` | `DuplicateMintsTheNextVersionAndCopiesAuthoring` | FAIL (caught) |
| chain ordered `version asc` | `VersionsReturnsTheLineageNewestFirst` | FAIL (caught) |
| archive also sets `published_at = null` | `ArchiveIsIdempotent` | FAIL (caught) |

The survivor is the finding, not a rounding error: with two *drafts*, the CTE's `status = 'active'` filter can never match the row being published, so deleting the self-exclusion is invisible to that test — the guard only bites when the row is ALREADY active, and even then the following update re-activates it, so the only observable is the lie in `archived_ids`. That produced test 3, and re-running the same mutant against it gives `--- FAIL: TestLiveDB_TemplateStudio_RepublishingTheLiveRowArchivesNothing (0.63s)` → **5/5 caught**, and the restored database passes all eight again.

- [x] **Step 3: `go vet ./tests/voting/`** (clean, above) then commit → `690e2952a test(contest-studio): live proofs for publish/duplicate/archive/version invariants` (1 file, +480).

## Task 8: Authoring layer and studio fields on create/PATCH

**Files:**
- Create: `frontend-web/src/server/template-studio/authoring.ts`
- Modify: `frontend-web/app/api/admin/voting/contest-templates/_shared.ts`, `…/route.ts` (POST), `…/[templateId]/route.ts` (PATCH)
- Test: `frontend-web/tests/unit/voting/template-studio-authoring.test.ts`, extend `tests/unit/voting/contest-templates-admin-api.test.ts`

**Interfaces:**
- Consumes: `BOUNDS`, `PRESETS`, `SHADOW_MODES` and `resolveBlendParams` from `blend/params.ts` (export the three consts in this task; their contents stay identical — the mutation census pins that a changed bound breaks the suite, not the import), plus `templateImagePlan` from `lib/media/template-image.ts` for the slot-art trust rule.
- Produces (as executed — `frontend-web/src/server/template-studio/authoring.ts`):
  - `export const PHOTO_MODES = ['auto','background','photo_area'] as const` + `export type PhotoMode`
  - `export const BLEND_PRESET_NAMES: BlendPresetName[]`, derived as `Object.keys(PRESETS)` so a fifth preset in the renderer can never be refused by the write gate
  - `export const SLOT_ANCHORS = ['auto','top','centre','bottom'] as const` (British spelling, verbatim from `20272200000000_contest_photo_blend.sql:28`)
  - `export type FieldVerdict = { ok: true; value: unknown } | { ok: false; code: string; error: string }`
  - `export function validatePhotoMode(raw: unknown): FieldVerdict` and `export function validateBlendPreset(raw: unknown): FieldVerdict`
  - `export type BlendSettingsVerdict = { ok: true; value: Record<string, unknown>; clamped: string[] } | { ok: false; code: string; error: string }`
  - `export function validateBlendSettings(raw: unknown): BlendSettingsVerdict`
  - `export function effectiveBlendParams(preset: unknown, settings: unknown): BlendParams`
  - `export type StudioFieldsVerdict = { ok: true; updates: Record<string, unknown>; clamped: string[] } | { ok: false; code: string; error: string }` and `export function parseStudioTemplateFields(body: Record<string, unknown>): StudioFieldsVerdict`
  - `export type SlotFieldsVerdict = { ok: true; row: Record<string, unknown> } | { ok: false; code: string; error: string }` and `export function parseStudioSlotFields(raw: unknown): SlotFieldsVerdict` — Task 9 consumes these; written here so the slot trust rule is one function, not two
  - `export function isEditableStatus(status: string): boolean`
  - `export function uuidOr(value: unknown): string | null`
  - in `_shared.ts`: `export function studioRpcFailure(prefix: string, error: { code?: string; message?: string } | null | undefined): Response`

  Two placements differ from the sketch above, and Task 11 reads them from here: `uuidOr` lives in `authoring.ts` rather than `_shared.ts` (it is a field rule; `_shared.ts` is the route layer that imports it), and `studioRpcFailure`'s error argument is nullable because PostgREST hands `null` as readily as an object. `_shared.ts` also gained `const RPC_NAME_PREFIX`, which strips the `publish_contest_template: ` prefix the migration writes — the format is pinned by the migration-text test in `template-studio-authoring.test.ts`, not by memory.

- [x] **Step 1: Failing unit tests** (`tests/unit/voting/template-studio-authoring.test.ts`, 48 tests) for the validator: unknown key → `blend_setting_unknown` naming the key and listing the legal ones; non-number and non-finite → `blend_setting_not_a_number`; `shadow: 'loud'` → `blend_setting_invalid`; `featherPx: 99` → clamped with `clamped: ['featherPx']`; a JSON string is parsed, `null`/array/blank accepted as "no overrides", a non-object refused as `blend_setting_invalid`; `photoMode: 'blur'` → `photo_mode_invalid`; a preset outside the four → `blend_preset_invalid`; `isEditableStatus('draft')` true and `('active')`/`('archived')`/`('pending')` false.

  Three additions the plan's list did not name, each because a weaker test would have passed for the wrong reason:

  1. **Parity with the renderer is asserted, not assumed.** For every key in `BOUNDS` the test builds a payload at that knob's ceiling and asserts the accepted key set equals `Object.keys(BOUNDS) ∪ {shadow}` — so adding a knob to `params.ts` cannot leave the gate refusing it. And `effectiveBlendParams('natural', saved.value)` is compared against `resolveBlendParams('natural', saved.value)`: if the two clamped differently, the studio preview and the delivered photo would disagree and neither would be wrong.
  2. **The field layer, not the validator, owns "blank means not sent."** `validateBlendSettings('')` legitimately answers `{}` — an empty override set is a legal set — but `parseStudioTemplateFields` must not turn a blank part into a written `{}`: on PATCH the column already holds the admin's overrides, and a form posting an untouched blank textarea would erase them. That is the one behaviour this task implemented backwards first (the red is recorded in Step 2).
  3. **The three field lists are pinned against the migration's own `CHECK (… IN (…))` text** the way `contest-template-bucket-policy.spec.ts` pins the mime allowlist, because a validator that accepts what the column refuses is a 500 on save.
- [x] **Step 2: Run to red**, implement, run to green. Red first showed the expected shape — `Cannot find module '@/src/server/template-studio/authoring'`; after the routes existed, one genuine red (`expected { blend_settings: {} } to deeply equal {}`) drove the blank-part fix above.

  `npm run type-check` then caught a defect the suite could not: `StudioFieldsVerdict`'s success member was declared without the `ok: true` discriminant, so every `if (studio.ok)` narrowed nothing. Vitest strips types, so all 80 tests passed on the broken union — recorded because it is the reason Step 5 keeps the type-check in the gate rather than trusting the suite. Re-measured after the fact by deleting the line again on the committed tree: **31 × TS2339 plus 1 × TS2322**, and `tsc --noEmit` back to **0 errors** with the line restored (`git diff` for the file empty, so the mutation left no residue).
- [x] **Step 3: Route tests, then routes.** The route coverage went into its own file, `tests/unit/voting/contest-templates-studio.test.ts` (13 tests), rather than into `contest-templates-admin-api.test.ts`: the two files assert different contracts (studio field semantics vs. the shipped upload/auth/lifecycle behaviour) and the existing file had already grown a 200-line comment block explaining its own failure modes. `contest-templates-admin-api.test.ts` was edited where D6 changed its subject — its two `hasContestantSlot` PATCH tests became three: `PATCH to active goes through the publish RPC and never writes status itself` (asserts `rpcCalls` equals exactly `[{ fn: 'publish_contest_template', args: { p_template_id: 'tpl-1', p_actor: null } }]` **and** `updatePayload === null`), `answers the RPC's own refusal, not a locally rebuilt one`, `reports a vanished template as 404`.

  The fake client both files needed was extracted to `tests/unit/voting/_contest-template-fake.ts` (the `_` prefix keeps vitest from collecting it, per the existing `_idempotency-fake.ts`), extended with `rpc()` and a `publishedRow` for the post-RPC re-read — and with the read-back merging the insert payload, which is what PostgREST's `INSERT … RETURNING` actually answers. Without that merge the clamped-value assertion could pass while the route reported the fixture's guess instead of what it wrote.

  What the routes do, beyond the plan's wording:

  - POST validates the studio fields **inside** the existing pre-upload gate (beside the `connectContestId` UUID check at `route.ts:161-170`) and spreads `studio.updates` last into the insert, so an absent part keeps the column default. `created_by` went through the new `uuidOr` — same rule, one implementation.
  - PATCH order is: read `id, status` → 404 → validate → 400 → if the payload writes a studio field and the row is not a draft, 409 `template_is_published` **before** the update object is built (so a request that also renames the template cannot apply the legal half) → UPDATE → then, only if `status:'active'` was asked, the publish RPC → then always a fresh read, because the UPDATE's row is stale by exactly the columns the RPC writes. `archivedIds` is read from the RPC's jsonb `archived_ids`.
  - `isEditableStatus` accepts `draft` only, so an `archived` row is refused too: `contest_photo_assets.template_id` points at past rows, and D6's own heading is "writable on draft rows only". `status` and `name`/`width`/`height` stay writable on any row — `DELETE` refuses an active template, so blocking lifecycle would strand it, and the shipped console sends those four today.
  - Both routes answer `effectiveParams` and `clamped` at the **top level** of the success body (not nested in `template`), and `effectiveParams` carries `preset` + the 16 knobs and never `photoMode`, which selects a placement path rather than a blend number.
- [x] **Step 4: `mapTemplateRow` gains** `photoMode`, `blendPreset`, `blendSettings` (defaulting `{}` when the column reads null), `publishedAt`, `publishedBy`; `mapSlotRow` gains `imageUrl`, `anchor`, `bleed`, `faceProtect` for Task 9.
- [x] **Step 5: Run** `npx vitest run tests/unit/voting && npm run type-check` → pass. Measured: **68 files, 592 tests passed, 1 todo**, `tsc --noEmit` clean. The one exception in a re-run was `free-vote.spec.ts > assertVotingOpen > throws if voting is disabled` timing out at its own 30000 ms; the same file passes 72/72 with `--no-file-parallelism` (that test alone takes 12.4 s serially, 25.6 s under parallel load), and `git diff --name-only` touches none of `engine`, `composite`, `wallet`, `free-vote` — the contention signature the Task 4 census already recorded for this laptop. The full 316-file suite hits the same wall (18 timeouts, 4 files); the two P2 blend files pass 16/16 serially with `--testTimeout=40000`.

  **Mutation census — nine mutants of the new logic, each run over the three files (baseline 80 passed), all caught, every file restored byte-identically by sha256:**

  | mutant | red count |
  | --- | --- |
  | `BOUNDS.featherPx` ceiling `2` → `9` | 4 failed / 76 |
  | unknown-key code `blend_setting_unknown` → `blend_setting_not_a_number` | 4 / 76 |
  | `clamped.push(key)` removed | 5 / 75 |
  | `isEditableStatus` also accepts `'active'` | 3 / 77 |
  | blank part no longer treated as "not sent" | 3 / 77 |
  | slot trust gate never matches (`plan.kind === 'never'`) | 2 / 78 |
  | fake answers the fixture row, ignoring the insert payload | 1 / 79 |
  | PATCH gate refuses `active` only (archived becomes editable) | 2 / 78 |
  | POST's `if (!studio.ok) return …` disabled | 3 / 77 |

  The last two matter more than the counts suggest: disabling the create-route gate is caught only by the `uploadKeys` assertions, which is the sole proof that validation runs before the byte transfer, and the fake row proves the read-back merge carries weight rather than decorating the fixture.

- [x] Committed → `8e8ccb40c feat(contest-studio): studio fields on create and patch, published rows read-only` (9 files, +1582 / −158).

## Task 9: Slot art round-trips through PUT

**Files:**
- Modify: `frontend-web/app/api/admin/voting/contest-templates/_shared.ts` (`mapSlotRow`), `…/[templateId]/slots/route.ts`
- Test: extend `tests/unit/voting/contest-templates-admin-api.test.ts`

**Interfaces:**
- Consumes: `templateImagePlan` (Task 2) to validate `imageUrl`.
- Produces: `SlotInput` gains `imageUrl?: string | null; anchor?: string; bleed?: boolean; faceProtect?: boolean`; `mapSlotRow` returns `imageUrl, anchor, bleed, faceProtect`.

  As executed, `SlotInput` carries those four as one parsed fragment — `artColumns: Record<string, unknown>` in storage shape — because `parseStudioSlotFields` already returns snake_case columns and re-translating them would be a second table to keep in sync. `mapSlotRow` already returned all four (Task 8 Step 4).

- [x] **Step 1: Failing tests** — 13 of them, and they went red for the right reason (9 failing before the route changed; the 2 that passed immediately are the regression pair: a geometry-only PUT on an art-free template, and the shipped contestant guard).

  They live in `tests/unit/voting/contest-templates-studio.test.ts` under `describe('slot art round-trips through PUT')` rather than in `contest-templates-admin-api.test.ts` as sketched: that file has no slot tests at all (the PUT route was untested before this task), and the studio file already owns the fake, the `draftRow()` fixture and the trusted-host env stub. Coverage: the four fields insert and read back; omitted fields insert `image_url null / anchor 'auto' / bleed false / face_protect true`; `https://evil.test/x.png` → 400 `slot_image_not_readable` with no delete; `anchor 'middle'` and the American `'center'` → `slot_anchor_invalid`; `bleed 'maybe'`, `faceProtect 1` → `slot_flag_invalid`; the drop guard on a geometry-only payload (naming the URL, no delete); a geometry payload allowed when nothing is stored; `imageUrl: null` honoured as a clear; the payload repeating the stored URL; a published row refusing art → 409 `template_is_published`; the shipped console's geometry PUT on an active template still succeeding; and the contestant guard still refusing.
- [x] **Step 2: Implement** — order is validate → read template → contestant guard (untouched, still first) → read stored art → D6 409 → drop guard → delete → insert.

  One correction to the step's wording before execution: the guard as first written ("an existing `image_url` that no slot in the payload repeats") also refuses the studio's own **clear**, since a slot that sends `imageUrl: null` does not "repeat" anything — art could then never be removed. The implemented rule asks who is responsible for the art set:

  - `ownsArt` — every slot states `image_url`, a URL or `null`. A payload that states it owns the set (so `null` deletes); one that never names it cannot delete anything.
  - `setsArtField` — any of the four named makes this the studio's request, so `isEditableStatus` gates it (409 on `active`/`archived`).

  The two are mutually exclusive by construction, which is what keeps the shipped console's PUTs passing on every template that has no art (all of them today — nothing has written art yet) while refusing the case the plan was written for. `ownsArt` is checked across the whole list rather than per slot because a replace has no stable slot identity: rows are deleted and re-inserted, so "slot 2 got `anchor`, slot 1's art was forgotten" is indistinguishable from "slot 1's art is wanted gone", and the safe reading of an ambiguous destructive request is a refusal that names the URL. An empty `slots: []` therefore cannot clear a template that has art — it has no row left to carry `null`, and the error says to clear the art first.

  Also repaired: the function's own header comment, which `44e3fb835 refactor: strip noise comments` had cut mid-sentence on `origin/main` ("two calls — not a money path, no DB / set must include at least one 'contestant' slot"). Comments only, no behaviour change.
- [x] **Step 3: Run** `npx vitest run tests/unit/voting && npm run type-check` → **68 files, 605 passed, 1 todo** (was 592 passed + 1 todo before the 13 new tests), `tsc --noEmit` clean.

  **Ten mutants, each run against `contest-templates-studio.test.ts` (baseline 26 passed), all red, every file restored byte-identically (sha256 equal):**

  | mutant | red count |
  | --- | --- |
  | `ownsArt` hardcoded `true` | 3 |
  | drop guard ignores ownership (`storedArt.length > 0` alone) | 2 |
  | drop guard inverted (`&& ownsArt`) | 5 |
  | `SLOT_ART_DEFAULTS` spread after `artColumns` (defaults win) | 2 |
  | `artColumns: {}` (parsed art discarded) | 4 |
  | stored-art read returns `[]` | 3 |
  | D6 409 gate disabled | 1 |
  | published refusal sent as 400 instead of 409 | 1 |
  | per-slot `parseStudioSlotFields` refusal disabled | 2 |
  | `slot_art_would_be_dropped` renamed | 3 |

  The first run scored M9 as `-1/-1`, i.e. no summary at all: the replacement text left an unbalanced brace, so vitest failed to collect the file. Recorded because "did not go red" and "did not run" look the same from a count, and the fix was to balance the block before re-running the whole census.

  Two counts worth reading: the single-red mutants (D6 gate, status code) are each covered by exactly one assertion, which is honest for a rule no shipped client can hit yet; and the stored-art read (3 red) shows the guard genuinely depends on the read rather than on the payload alone.
- [x] Committed → `db9bec195 feat(contest-studio): slots carry their own art` (3 files, +413 / −8).

## Task 10: Preview — sample portrait in, composited PNG out

**Files:**
- Create: `frontend-web/src/server/template-studio/preview.ts`, `frontend-web/app/api/admin/voting/contest-templates/[templateId]/preview/route.ts`
- Modify: `frontend-web/src/server/registration/template-resolver.ts` (export `toSlot`)
- Test: `frontend-web/tests/unit/voting/template-studio-preview.test.ts`

**Interfaces:**
- Consumes: `readTemplateImage`, `compositeWithBlend`, `resolveBlendParams`, `validateBlendSettings/validateBlendPreset/validatePhotoMode`, `toSlot`.
- Produces: `export async function buildPreview(input: PreviewInput): Promise<PreviewResult>` with
  `type PreviewResult = { ok: true; buffer: Buffer; mimeType: string; decisions: Record<string, unknown> } | { ok: false; status: number; code: string; error: string }`, refusal codes `sample_required`, `sample_needs_cutout`, `sample_unreadable`, `template_not_found`, `no_contestant_slot`, `canvas_too_large`, `template_bytes_unreadable:<reason>`, and the route's headers `X-Blend-Applied`, `X-Render-Decisions`.

- [x] **Step 1: Failing tests** — 28 of them, in `tests/unit/voting/template-studio-preview.test.ts`. The first run could not even collect: `Error: Cannot find package '@/src/server/template-studio/preview'` → `Test Files 1 failed`, `Tests no tests`. Recorded because "the module does not exist yet" and "the module exists and every branch is wrong" both arrive as a red file, and only the summary line tells them apart.

  The sketched four became five groups. `selectPreviewSlots` (2) is tested as a pure row filter, because the two rules it encodes — lowest `slot_order` wins the contestant window, art-bearing non-contestant rows follow `z_index` — are otherwise reachable only through the resolver's SQL and no unit test can see them. Refusals (11) cover `sample_required`, the D4 alpha gate, `sample_unreadable`, `sample_too_large`, `canvas_too_large`, `template_geometry_invalid`, `no_contestant_slot`, `template_bytes_unreadable:host-not-allowed`, all four authoring validator codes, and a non-finite nudge; four of them also assert `readTemplateImage` was **not** called, which is the only way to tell "refused before spending a frame read" from "refused after". The render group (8) asserts bytes, `mimeType`, `decisions.applied`, the exact width/height, the frame read happening *once*, effective params + `clamped` (D5), the `off` preset's `applied: false`, an empty-matte sample degrading instead of failing (§10), slot art actually reaching the composite (§8.1), and D3 by scanning the module's own source for the write surface. The route group (7) runs the real `buildPreview` behind a stubbed frame read, so field names cannot drift between the two layers: 403 before Supabase, the two headers, `no_contestant_slot` → 400, `template_not_found` → 404, 415 for a non-multipart body, 400 for a form without a file, and a `xOffset: '40'` that measurably moves `decisions.placement.target.left` relative to the un-nudged render.

  Two test-design decisions worth keeping: the §8.1 art test stubs `globalThis.fetch`, because `toSlot`'s art URL is fetched by the compositor itself — the first version of that test "passed" while a real request to the local storage service answered 400 and the ribbon silently disappeared from the render, i.e. it was asserting a graceful degrade rather than the art. And the alpha fixtures are made with `channels: 3` (a phone JPEG has no alpha at all) rather than an opaque RGBA, because `sharp`'s `hasAlpha` reports the *channel*, and a 4-channel fully-opaque matte would pass the D4 gate while previewing exactly the sticker the decision refuses.

- [x] **Step 2: Implement** `buildPreview` — checks run cheapest-first: row present → sample present → sample size → row geometry → canvas side → the three field validators → the three nudges → alpha → slot selection → frame read → render. Deviations from the step's wording, each taken deliberately:

  - The step names `templateImagePlan`/`readTemplateImage`. Only `readTemplateImage` is called: it runs the plan internally and returns the same named reason, so asking for the plan as well would give the preview two owners of one trust rule and a second refusal path no test could distinguish. The refusal code still carries the reason verbatim (`template_bytes_unreadable:host-not-allowed`), which is what the plan wanted from the pair.
  - Four codes the list did not name, because the branches they describe arrived with the implementation: `template_geometry_invalid` (409 — a row whose `width`/`height` are not two positive numbers cannot be sized, and answering that with `canvas_too_large` would tell the operator to shrink a template that has no size), `sample_too_large` (413), `override_not_a_number` (400), and `preview_render_failed` (409 — the composite itself throwing, reported rather than hidden behind a 500 stack).
  - `MAX_PREVIEW_SIDE = 4096` refuses only the synchronous path; the message says contestant photos still render at full size, so a large template does not read as broken. `MAX_SAMPLE_BYTES` reuses `MAX_CONTEST_TEMPLATE_UPLOAD_BYTES` rather than inventing a preview ceiling — same number, one place.
  - `compositeWithBlend` is called **without** `fallback`. The runner's fallback is a URL-shaped paste it can re-fetch; the preview has no stored subject and no business keeping a second image around, so a real composite failure surfaces as `preview_render_failed` instead of returning an unblended portrait that looks like an answer. An engine that *declines* still produces pixels, which is the §10 branch the empty-matte test covers.
  - `toSlot` is now exported from `src/server/registration/template-resolver.ts`, along with `SLOT_COLUMNS`/`TEMPLATE_COLUMNS`, so the preview route selects the same eight + eighteen columns the queue does. A second column list is a second place a future art column gets forgotten.
  - D3 is enforced, not just commented: the test reads the module's source and refuses `storePhoto`, `upsertPhotoAsset`, `photo_jobs`, `createPhotoJob`, `.rpc(`, `createClient`, `.insert(`, `.update(`, `storage.from`. The plan's original word list included `queue`, dropped because it forbids prose ("no queued work") rather than writes — a guard that fails on a comment trains nobody to read it.

- [x] **Step 3: Route** — as specified, plus `runtime = 'nodejs'` / `dynamic = 'force-dynamic'` and `new NextResponse(Buffer.from(result.buffer) as unknown as BodyInit, …)`: the cast is needed because this Next/TypeScript pairing does not accept `Buffer` as a `BodyInit` without it. `text()` treats an empty form field as absent (the row decides), while `number()` deliberately lets `Number('lots')` through as `NaN` so `buildPreview` refuses it — filtering the typo to `undefined` here would silently move the portrait back to the template's own placement, which is precisely the form-vs-render disagreement D5 exists to prevent. A missing row skips the slot read (there is no id to read slots for) but still goes through `buildPreview`, so the sentence and the code have one owner.

  The header-shape assertion arrived as a separate commit (`60aa0cf71`): a test that only ever calls `decodeURIComponent` cannot tell an encoded header from a raw JSON one, since both parse. Asserting the raw value contains no `{` is what makes the encode step a contract instead of a habit — and it is the assertion mutant M14 dies on.

- [x] **Step 4: Run** — `npx vitest run tests/unit/voting/template-studio-preview.test.ts` → **28 passed**; `npx vitest run tests/unit/voting` → **69 files, 633 passed, 1 todo** (was 68/605/1, i.e. exactly the 28 new tests); the wider `tests/unit/voting tests/unit/photo-jobs` run, which the resolver export touches, → **89 files passed + 1 skipped, 811 passed | 1 skipped | 1 todo**. `npm run type-check` → **0 errors**, after two real problems the first run caught: `PreviewTemplateRow` needed `id`/`version` (the route selects them), and a zero-argument `vi.fn` stub types `mock.calls` as `[]`, so the art-fetch assertion could not index the call it was asserting on.

  Committed → `4762ac3de feat(contest-studio): synchronous studio preview render` (4 files, +866 / −5), then `60aa0cf71 test(contest-studio): pin the decisions header to its encoded form`.

  **Fifteen mutants, each run against the preview file alone (baseline 28 passed), all red, both files restored byte-identically (sha256 equal, and `git status --porcelain` clean afterwards):**

  | mutant | red count |
  | --- | --- |
  | M1 no-sample guard disabled | 2 |
  | M2 D4 alpha gate inverted | 13 |
  | M3 sample byte cap removed | 1 |
  | M4 `MAX_PREVIEW_SIDE` cap removed | 1 |
  | M5 row-geometry guard removed | 1 |
  | M6 no-contestant-slot guard removed | 2 |
  | M7 `blend_settings` validation skipped | 1 |
  | M8 `blendPreset` validation skipped | 1 |
  | M9 nudge finite-number guard removed | 2 |
  | M10 frame-read refusal bypassed | 1 |
  | M11 contestant picked by row order, not `slot_order` | 1 |
  | M12 art-less overlay rows no longer filtered | 1 |
  | M13 effective params dropped from the decision record (D5) | 1 |
  | M14 decisions header sent raw, not percent-encoded | 1 |
  | M15 preview response cacheable | 1 |

  Uniqueness was checked before any mutation ran (the driver refuses to start unless all 15 anchors occur exactly once), which is what keeps Task 9's failure mode — a mutant that never applied reading as "no failure" — from recurring. Three counts say something about the shape of this feature: M2's 13 reds are the alpha gate inverted, so nearly every render test depends on the D4 decision being one-way; the singletons are each one assertion deep, which is honest for branches no shipped client can reach yet; and M11/M12 together show the slot-selection rules are covered by the pure helper rather than by an accidental pass through the render path.

  One correction to the task's own title and Step 1's wording: the answer is not always a PNG. `compositeImage` encodes JPEG when the blend supplies a `jpegQuality` *and* the finished composite has no transparent pixels (`imageCompositor.ts:494-496`), so the preview's `mimeType` is the compositor's verdict and the test asserts `/^image\//` plus the returned `width`/`height` rather than hard-coding a format. The fixture templates keep transparent regions, which is what a real authored frame has above the contestant window, so in practice these previews do come back PNG.

## Task 11: Lifecycle and art-upload routes

**Files:**
- Create: `…/[templateId]/{duplicate,publish,archive,versions,slot-art}/route.ts`
- Test: `frontend-web/tests/unit/voting/template-studio-lifecycle.test.ts`

**Interfaces:**
- Consumes: `studioRpcFailure`, `uuidOr`, the four RPCs, `ALLOWED_IMAGE_MIME_TYPES`/`MAX_CONTEST_TEMPLATE_UPLOAD_BYTES`/`describeStorageFailure`/`EXT_BY_MIME` equivalents from the create route (move `EXT_BY_MIME` and `ACCEPTED_LABEL` into `_shared.ts` so the two upload paths cannot drift).
- Produces: `POST duplicate` → 201 `{ success, templateId, version }`; `POST publish` → 200 `{ success, template, archivedIds }`; `POST archive` → 200 `{ success, changed }`; `GET versions` → 200 `{ success, versions }`; `POST slot-art` (multipart `file`) → 201 `{ success, imageUrl }` with key `slots/<templateId>/<uuid>.<ext>` in the same bucket.

- [x] **Step 1: Failing tests** — `tests/unit/voting/template-studio-lifecycle.test.ts` written first; the run failed to collect at all with `Cannot find package '@/app/api/admin/voting/contest-templates/[templateId]/duplicate/route'` and **Tests no tests**. Final shape: **44 tests** in five groups — the five routes' shared preconditions (10, generated by looping one `it` pair over all five so a route added later is covered by the loop rather than remembered), `duplicate` (7), `publish` (6), `archive` (5), `versions` (5), `slot-art` (11).

  The spec's own wording was checked rather than followed twice. `does not exist` is **not** uniformly a 404: `studioRpcFailure` (Task 7) sends a missing *function* to 500 `studio_rpc_missing` and only a `22023` raise that says `no contest template` to 404 `template_not_found` — an environment without migration `20272300000000` applied is not a template that went missing, and nothing the admin presses fixes it. Likewise `route.ts:237` is now `route.ts:182` for the `p_actor: uuidOr(identity?.actorId)` precedent.

  Every refusal that is supposed to happen *before* a write is asserted as `calls.uploadKeys`/`calls.rpcCalls` still empty, which is the only way a later re-ordering of the checks shows up as a failure instead of a slower success.

- [x] **Step 2: Implement** — five route files, plus two shared moves:

  - **The upload contract moved into `_shared.ts` — four constants, not the two this task listed.** `EXT_BY_MIME` and `ACCEPTED_LABEL` were the plan's scope, but `BUCKET` and `ALLOWED_IMAGE_MIME_TYPES` are the other half of the same bucket truth, and a slot-art route that imports two names from `_shared` and two from a sibling *route module* is worse than either. `route.ts` now re-exports `BUCKET`/`ALLOWED_IMAGE_MIME_TYPES`, so `tests/unit/voting/contest-template-bucket-policy.spec.ts` and `tests/integration/voting/contest-template-storage.test.ts` keep their import path and the spec keeps pinning the set against the bucket row in 20260405700000 (mutant M21 kills 12 tests across three files; M22 kills 2 by deleting the re-export).
  - **No `src/server/template-studio/lifecycle.ts`** (spec §7's file layout). `callStudioRpc` and `readStudioRow` went into `_shared.ts` beside `studioRpcFailure`, which is the module that already owns the failure shape; a second file would have split "one error shape" across two places. `readStudioRow` is what makes the last column of the response table honest: after the RPC, all three write routes re-read `contest_templates` and answer `mapTemplateRow(row)`, so `status`/`version`/`published_at`/`published_by` are the database's values (D5), and a read that *fails* or comes back empty is a 500 rather than a 404 — the action happened, and "not found" would invite a second publish of a template that is already live.

  Deviations from the plan/spec on the response bodies, all of them additive or naming:

  | route | plan/spec said | delivered | why |
  | --- | --- | --- | --- |
  | `POST duplicate` | `201 {success, templateId, version}` | `+ template, slots` | the console opens the studio on the copy, which needs its slot rows; without them it is a second GET before the first paint |
  | `POST archive` | `{success, changed}` (plan) / `{success, template}` (spec §7) | both | same reason: the row's status changed on screen |
  | `GET versions` | `chain: […]` snake_case | `versions: […]` camelCase (`publishedAt`, `createdAt`) | the console's house style; the SQL's `order by version desc` is preserved, never re-sorted |
  | all five | not specified | `400 template_id_invalid` when the path segment is not a UUID | without it a slug reaches Postgres, `22P02` arrives, and `studioRpcFailure` reports a 500 for the server about a mistake in the caller's URL |
  | `POST slot-art` | not specified | `409 template_is_published` for a non-draft row, **before** the upload | D6: the slot PUT refuses art onto a published row, so an object uploaded here could never be attached by anything — it would sit in the bucket with no row and no route that would ever delete it |
  | `GET versions` | 404 for an unknown row (implied) | `200 versions: []` | that *is* the function's answer for a row that isn't there (`up` finds nothing → `jsonb_agg` null → coalesced `[]`); a route-level existence read would be a second opinion on the same question |

  `slot-art` also keeps the frame route's ordering — type before size, both before any row read — and derives the stored extension from the mime type instead of the filename, so a `.jpg` that is really WebP lands as `.webp` with `contentType: image/webp`.

- [x] **Step 3: Run** — `npx vitest run tests/unit/voting/template-studio-lifecycle.test.ts` → **44 passed**; `npx vitest run tests/unit/voting` → **70 files, 677 passed, 1 todo** (was 69/633/1 — exactly the 44 new tests); `npx vitest run tests/unit/voting tests/unit/photo-jobs` → **90 files passed + 1 skipped, 855 passed | 1 skipped | 1 todo** (was 89/811/1). `npm run type-check` → **0 errors**; `npx eslint` on the seven changed route/test files → no output.

  Committed → `1d884d32b feat(contest-studio): duplicate/publish/archive/versions/slot-art routes` (9 files, +1339 / −39).

  The shared fake `_contest-template-fake.ts` grew four things for this task, each because a property was otherwise unprovable: `eqs` (which table/column/value every `.eq()` applied — the only way to see that duplicate reads the *copy* rather than the parent), `uploads` (the `upload()` options, so the stored content type is pinned), and `templateReadError`/`publishedReadError`/`slotReadError` (a route that answers 404 for a database outage otherwise passes a one-error fake).

  **Twenty-two mutants across seven files (baseline 44 passed), driven by `/tmp/t11_mutants.py` with the same anchor-uniqueness preflight as Task 10 — all restored byte-identically, `git status` clean afterwards:**

  | mutant | red |
  | --- | --- |
  | M1 duplicate `p_actor` verbatim | 1 |
  | M2 duplicate slot read scoped to the path id | 1 |
  | M3 duplicate unnamed-result guard removed | 1 |
  | M4 duplicate answers 200 not 201 | 2 |
  | M5 publish reads `archivedIds` off the RPC's `archived_ids` | 1 |
  | M6 publish `p_actor` verbatim | 1 |
  | M7 archive derives `changed` from the RPC answering | 1 |
  | M8 archive `p_actor` verbatim | **0 → survivor** |
  | M9 versions passes an actor to a read | 1 |
  | M10 versions re-sorts the chain | 1 |
  | M11 versions leaks snake_case | 1 |
  | M12 slot-art byte ceiling removed | 1 |
  | M13 slot-art mime ceiling removed | 1 |
  | M14 slot-art D6 gate removed | 1 |
  | M15 slot-art key from the client filename | 2 |
  | M16 slot-art content type hardcoded | 1 |
  | M17 slot-art UUID check removed | 1 |
  | M18 archive UUID check removed | 1 |
  | M19 shared read-back missing-row guard removed | 1 |
  | M20 shared read-back error treated as missing | 1 |
  | M21 shared mime list drifts (PNG dropped) | 12 (3 files) |
  | M22 create stops re-exporting the contract | 2 (2 files) |

  M8 is the census earning its keep: `archive_contest_template` declares `p_actor uuid` and then never reads it — `published_at`/`published_by` stay as history — so passing the literal `'api-key'` is invisible in the response but still fails Postgres' argument typing. No test pressed archive as an `x-admin-key` caller, so the guard had no victim. Added `passes p_actor null for an api-key caller, whose id would fail the uuid signature` and re-ran M8 alone: **1 failed | 43 passed**, file restored by sha256. That is the whole reason the archive group has five tests where publish has six and the shape is identical.

  One test transport note, written into the file: the 413 case hands the route a prepared `FormData` through a stub request. undici recomputes `File.size` from the parsed part, so a 50 MB ceiling can only be exercised against a real 50 MB body — 50 MB of buffer per run for an assertion about a comparison. Every other upload test, including the 415 non-multipart case, goes through a real `Request`.

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

  Task 9 tightened why that last rule is load-bearing: the PUT route's `ownsArt` test is "`image_url` is stated on **every** slot", so a payload that omits it on even one slot is treated as an art-unaware client and gets 400 `slot_art_would_be_dropped` wherever stored art exists. Send `imageUrl: null` for a slot with no art — never leave the key out.

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
