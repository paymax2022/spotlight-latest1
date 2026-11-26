# Contest photo assets and durable render jobs — design (P1)

Status: approved in direction by the requester ("take charge, continue and complete").
Owner of implementation: this repo, `frontend-web` (Next.js BFF) + `supabase/migrations`.
Companion to the attached product spec "SPOTLIGHT — AI CONTESTANT PHOTO COMPOSITING &
TEMPLATE MANAGEMENT SYSTEM", which this document covers as sub-project 1 of 4.

## 1. Why this is four sub-projects

The attached spec spans a data model, an async worker, a compositing engine, an admin
template studio, a contestant image editor and five rendering surfaces. That is more than
one spec, so it is decomposed. Each sub-project gets its own design → plan → implementation
cycle, and each is independently shippable.

| # | Sub-project | Spec sections it serves | Depends on |
|---|-------------|-------------------------|------------|
| P1 | **Asset model + durable render jobs** (this document) | §10 pipeline service, §11 storage, §12 failure handling, §16 privacy/security, "never overwrite the original" | — |
| P2 | Compositing engine: Mode A/B, subject-aware placement, overlay art, blend presets | §5, §6 | P1 |
| P3 | Admin template studio: real upload, visual slot editing, sample-portrait preview, draft/publish/versioning | §4, §8, admin workflow steps 1-6 | P1 |
| P4 | Contestant preview-and-adjust editor + unified presentation + variants | §7, §9, §13, §15 | P1, P2 |

Build order P1 → P2 → P3 → P4. P3 and P4 are consumers of P1's contract and P2's renderer;
P1 has no UI dependency and is the only one that can be merged without the others working.

## 2. What exists today, verified from the tree

Established by reading the code, not inferred:

- `frontend-web/src/lib/media/cloudinary.ts` performs signed Cloudinary upload-by-fetch-URL,
  with `removeBackground()` (`background_removal: cloudinary_ai`, `flags: stripprofile`) and
  `moderatePhoto()` (`moderation: aws_rek`, fail-closed). The file carries an in-code
  `// TODO: verify against live Cloudinary docs` on both param and response shapes.
- `frontend-web/src/server/registration/photo-pipeline.ts` orchestrates
  moderate → extract → composite → persist, and `template-resolver.ts` resolves the active
  template + contestant slot through the `contest_templates.connect_contest_id` bridge.
  The module doc's claim that no bridge exists is stale and is corrected by this work.
- `supabase-store.ts:1057-1100` runs that pipeline **synchronously inside the admin review
  request** and then writes the result back over `form_data['media.photoUrl']`.
- `frontend-web/src/lib/rendering/imageCompositor.ts` composites slots with sharp:
  resize-by-crop-mode, rotate, SVG `dest-in` rounded-rect mask, opacity multiply.
- The Cloudinary account `paymax` is live in production: `mobile-app/reactnative/src/lib/cloudinary.ts`
  builds `https://res.cloudinary.com/paymax/image/upload/f_auto,q_auto,w_<bucket>/<publicId>`
  for marketing banners, with the cloud name hard-coded as a fallback. So the vendor account
  exists and is already trusted with public traffic.

Four defects follow from that arrangement, and they are what P1 fixes:

1. **The original photograph is destroyed.** `nextFormData['media.photoUrl'] = pipelineResult.photoUrl`
   replaces the only reference to the uploaded file. Re-running the pipeline, or changing a
   template, is impossible; the spec's "never overwrite the original" rule cannot be met by
   this data shape at all.
2. **No status, no retry, no idempotency.** If Cloudinary or sharp fails mid-request the work
   is lost and the reviewer only sees an exception. There is no record that a render ever ran.
3. **The render runs in the admin's HTTP request.** A vendor call plus decode/compose/encode
   sits behind one request timeout; the spec asks for a non-blocking status flow and there is
   nowhere to poll.
4. **The source URL is not fetchable by the provider.** Uploads are handed back as the relative
   route `/api/registration/uploads/<base64url(key)>` (`app/api/registration/uploads/route.ts`),
   and `form_data['media.photoUrl']` holds exactly that. Cloudinary's upload-by-fetch-URL needs
   an absolute, publicly reachable URL, so feeding it the stored value cannot work — the call
   fails and `moderatePhoto` fails closed. A provider-fetchable, time-boxed URL has to be
   derived from an object key, which is another reason the asset must be a row rather than a
   string in a JSON blob.

Configuration facts and their limits: no server-side `CLOUDINARY_*` name appears anywhere in
`docs/devops` (only `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME` in the EAS profile, which holds exactly
six keys), `R2_PUBLIC_BASE_URL` is blank in `frontend-web/.env.example:41`, and the ledger lists
`R2_ENDPOINT`/`R2_BUCKET_NAME` among keys production lacks. **I could not prove the deployed
state from here**: a Railway production variables read enters the GitHub `Production`
environment, which parks for a named human approver, and I never approve or write production
configuration on someone's behalf. This design therefore makes configuration state observable
instead of assuming it (§7).

## 3. Decisions taken, and the alternatives rejected

**Where the async work runs: a Postgres job table drained in-process by `frontend-web`.**
The table and claim semantics are copied from the scheduler that already works in this repo
(`backend/internal/scheduler/service.go`: `FOR UPDATE SKIP LOCKED`, `run_key` uniqueness,
doubling backoff 30 s → 6 h, pause-on-exhaust for operator review), expressed in SQL and
drained from Node because sharp, Cloudinary and the R2 client all live in that process.
Rejected: a fourth Railway service running a Node worker — deterministic and independent, but
it adds a deploy leg and an env surface to a repo with zero Node-service precedent, in a
project whose deployment path has been the main source of pain. Rejected: the Go scheduler
owning the job and calling back into a Node endpoint — it reuses real machinery and real
operator tooling, but there is no service-to-service auth between Go and Node today, and the
image work still happens in Node, so it buys a hop rather than a capability. Because the table
shape matches, moving only the drain to a dedicated worker later is mechanical and does not
change this contract.

Known weakness, accepted deliberately: a process with no traffic drains nothing. Mitigated by
draining opportunistically on every request that touches the module, by a bounded tick, and by
an explicit "process now" admin action that runs the same claimed job path.

**How the photographic blend is produced (P2, recorded here so P1's contract can hold it):
hybrid.** Cloudinary owns subject extraction, edge feathering and colour/lighting match; sharp
owns geometry, contact shadow, z-order layering, text overlays and variant resizing. The
quality-critical perceptual part stays vendor-owned and the layout part stays unit-testable
against fixtures. Rejected: all-sharp (deterministic and free, but hand-tuned alpha morphology
will not hold hair and clothing detail — it fails the spec's central promise) and
all-Cloudinary (fewer moving parts, but puts template geometry under parameter-length limits,
charges per variant and discards the compositor that exists). Blend strength will be an
admin-selectable preset (`natural` / `studio` / `bold`) rather than hard-coded tuning, and
P1 stores the chosen parameters on the asset so a render is reproducible.

## 4. Data model

One forward-only additive migration, next free version:
`supabase/migrations/20272000000000_contest_photo_assets_and_jobs.sql`.
Conventions honoured: `gen_random_uuid()` ids, snake_case, `text` + `check` in preference to
enums where a value set may grow, `payload`/params as `jsonb`, partial indexes on the hot
status set, RLS enabled on every new table (`make rls-check` is a go-live gate and its
allowlist is only `spatial_ref_sys`).

```sql
create table public.contest_photo_assets (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid references public.registrations(id) on delete cascade,
  contestant_id    uuid references public.contestants(id) on delete set null,
  contest_id       uuid,                       -- connect_contests.id, no FK: matches bridge table
  kind             text not null check (kind in
                   ('original','transparent','final','preview','thumbnail')),
  storage_key      text,                       -- our bucket object key; authoritative for 'original'
  provider_url     text,                       -- vendor-hosted delivery URL, when the bytes are theirs
  content_type     text not null default 'image/png',
  width            integer,
  height           integer,
  bytes            bigint,
  template_id      uuid references public.contest_templates(id) on delete set null,
  template_version integer,
  render_params    jsonb  not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  -- every kind must carry at least one resolvable location: ours (storage_key) or the vendor's
  constraint contest_photo_assets_shape_check check (
    (kind = 'original'   and storage_key is not null) or
    (kind = 'transparent' and coalesce(storage_key, provider_url) is not null) or
    (kind in ('final','preview','thumbnail') and coalesce(storage_key, provider_url) is not null)
  )
);

create unique index contest_photo_assets_kind_location
  on public.contest_photo_assets (kind, coalesce(storage_key, provider_url));
```

That unique index is what makes asset writes idempotent at the database level: a retried job
that re-ingests the same bytes lands on the existing row instead of accumulating duplicates,
so the application's insert-only discipline does not have to be perfect for the table to stay
clean.

`storage_key` and `provider_url` are deliberately separate: the original is ours and must stay
ours, the transparent cutout may legitimately live at the vendor (that is what
`removeBackground` returns today), and the final composite is always re-ingested into our
bucket so a surface never depends on a vendor URL surviving.

The original is immutable, enforced in the database rather than by convention:

```sql
create function public.reject_contest_photo_asset_mutation() returns trigger ...
  if old.kind = 'original' then raise exception 'contest_photo_assets kind=original is immutable'
```
`before update or delete` for `kind = 'original'`, and `before update` only for the remaining
kinds except the bookkeeping columns. Writes are insert-only from the application's point of
view; a re-render creates a new asset row and points the registration at it.

```sql
create table public.contest_photo_jobs (
  id               uuid primary key default gen_random_uuid(),
  run_key          text not null unique,       -- idempotency: the scheduler's own trick
  registration_id  uuid not null references public.registrations(id) on delete cascade,
  contest_id       uuid,
  template_id      uuid,
  source_asset_id  uuid not null references public.contest_photo_assets(id) on delete cascade,
  status           text not null default 'queued' check (status in
                   ('queued','extracting','compositing','ready','failed','cancelled','paused')),
  progress         integer not null default 0,
  attempt          integer not null default 0,
  max_attempts     integer not null default 6,
  available_at     timestamptz not null default now(),
  locked_at        timestamptz,
  locked_by        text,
  last_error       text,
  render_params    jsonb  not null default '{}'::jsonb,
  result_asset_id  uuid references public.contest_photo_assets(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index contest_photo_jobs_due on public.contest_photo_jobs (available_at)
  where status in ('queued','failed');
create index contest_photo_jobs_registration on public.contest_photo_jobs (registration_id, created_at desc);
```

`run_key` is `photo:<source_asset_id>:<template_id or 'none'>:<render_hash>` where `render_hash`
is a short sha256 prefix of the normalised `render_params`. Two submissions of the same photo
against the same template and same editor settings therefore enqueue one job, which is what
makes the endpoint safe to retry from a flaky mobile client. Changing the editor settings
changes the hash and creates a genuinely new job rather than mutating an old one.

RLS: `enable row level security` on both tables plus a deny-all default (no `to public` policy).
These rows are read exclusively by the BFF with the service role and by the Go backend's
service-role client, mirroring how other server-only tables in this repo are protected. A
separate read policy for the owning contestant is added in P4 when the contestant editor needs
to poll its own job; adding a broad `auth.uid()` policy now would be a permission we cannot yet
justify.

## 5. Code layout

Each unit has one job, a stated interface, and is testable on its own.

- `frontend-web/src/lib/media/provider.ts` — the provider abstraction the spec §10 asks for:
  `interface PhotoProvider { name: string; configured(): boolean; extractBackground(sourceUrl):
  Promise<ExtractResult>; moderate(sourceUrl): Promise<ModerationResult>; probe(): Promise<ProbeResult> }`
  plus `getPhotoProvider()` returning the Cloudinary implementation. This module contains no
  HTTP of its own; `cloudinary.ts` remains the only place Cloudinary HTTP lives, so the
  abstraction is a seam, not a second client.
- `frontend-web/src/lib/media/asset-source.ts` — turns a stored value into something a vendor
  can fetch: accepts an object key or a legacy relative upload route, returns an absolute
  https URL with a bounded lifetime (`createR2DownloadUrl`, `SITE_URL`-qualified) or reports
  `notFetchable` with the reason. This is the unit that fixes defect 4 and it is where the
  provider's fetchability requirement stops being implicit.
- `frontend-web/src/server/photo-jobs/job-store.ts` — data access only: `enqueueJob`,
  `claimDueJobs({ workerId, limit })` (one statement, `FOR UPDATE SKIP LOCKED`, sets
  `locked_at/locked_by/attempt`), `markStatus`, `completeJob`, `failJob` (doubling backoff from
  30 s, ceiling 6 h, `paused` once `attempt >= max_attempts`), `jobFor`, `staleLocks`.
- `frontend-web/src/server/photo-jobs/registry.ts` — reads the original from storage
  (`src/lib/storage/contestant-photo.ts` already resolves R2/local/404), inserts the `original`
  asset idempotently, and calls `enqueueJob`. This is the single entry point the rest of the
  app uses: `registerOriginalAndEnqueue({ registrationId, userId, storedValue, contestSlug, renderParams })`.
- `frontend-web/src/server/photo-jobs/runner.ts` — executes one claimed job: provider extract →
  write `transparent` asset → compositor render → `final` + `preview` + `thumbnail` assets →
  `completeJob`. Every stage sets `progress` and `status` so a poll answers truthfully. It never
  throws past the boundary: a stage failure becomes `failJob` with the vendor or sharp message.
- `frontend-web/src/server/photo-jobs/worker.ts` — the drain: `drainPhotoJobs({ limit })` claims
  and runs sequentially; `maybeDrainPhotoJobs()` is called from the enqueue path and from the
  status route so an idle process still makes progress on real traffic; a module-scoped
  `globalThis` guard starts one bounded interval per process and never a second one.
- `frontend-web/app/api/photo-jobs/[id]/route.ts` — `GET` status for the job's owner
  (`queued/extracting/compositing/ready/failed/paused`, `progress`, and on `ready` the asset
  references). `POST` cancel. P4 adds `POST` re-render with new params here.
- `frontend-web/app/api/admin/photo-config-status/route.ts` — §7 below.

## 6. Flow, and how the review path changes

Contestant submits a registration with a photo field:

```
POST /api/registration/applications
  → save bytes (unchanged: R2 when configured, local-disk fallback when not)
  → registry.registerOriginalAndEnqueue()      ← inserts contest_photo_assets(kind='original')
  → job-store.enqueueJob(run_key)              ← idempotent
  → maybeDrainPhotoJobs()                      ← returns immediately; the request never waits
  → 201 with { photoJobId }
```

The editor or any surface polls `GET /api/photo-jobs/<id>` until `ready`, then renders the
`final`/`preview` asset. Nothing in this flow blocks a request on a vendor call.

Admin approval changes in one specific way: `reviewRegistrationApplication` no longer assigns a
pipeline output to `form_data['media.photoUrl']`. It reads the registration's ready `final`
asset when one exists, records `media.photoAssetId` and `media.originalAssetId` alongside a
`media.presentation` marker, and **leaves the original value untouched**. When no ready asset
exists it does not run a synchronous render inside the review request any more; it enqueues a
job and answers the reviewer with a distinct outcome — `photo_processing` (approved, portrait
pending, re-check available) rather than pretending the portrait is final. A rejection that
turns an approval into a 500 because a vendor timed out is worse for the operator than an
explicit pending state, and `promote_registration_to_contestant()` gains a parameter for the
final asset URL instead of reading a mutated blob value.

The existing synchronous path is not deleted silently: `processContestantPhoto` keeps its
behaviour and tests, and the job runner calls the same composition code. What changes is who
invokes it and when.

## 7. Failure handling and observability

The spec requires that a failure never produces an incomplete portrait. Concretely:

- A surface never receives a half-composed image. Only a job that reached `ready` publishes a
  `final` asset; `extracting`/`compositing` rows are invisible to readers, and the presentation
  layer falls back to the **original** (never to a blank or a partially drawn frame) with an
  explicit `presentation: 'original'` flag so the UI can label it as unprocessed rather than
  passing it off as the finished composite.
- Vendor failure, non-JSON response, missing `secure_url`, unreachable template, zero-byte or
  un-decodable source, R2 write failure: each maps to `failed` with `last_error`, then retries
  on the backoff ladder, then `paused` after six attempts. `paused` means "an operator should
  look", and the admin console list surfaces the count.
- Moderation stays fail-closed exactly as `moderatePhoto` implements it today. A job whose
  moderation rejects produces **no** `final` asset and a terminal `cancelled` status with the
  vendor reason — the failure is not retried, because retrying a content-safety verdict is not
  a transient error.
- The dev-only relaxation in `runModerationGate` (skip when creds are literally absent) stays
  confined to local development, and §7's probe makes its production absence of configuration
  visible instead of quiet.

`GET /api/admin/photo-config-status` answers booleans and short verdicts only, never a value:

```json
{ "provider": { "configured": true, "name": "cloudinary", "cloudNamePresent": true,
                "extractionProbe": "ok|not_attempted|failed",
                "moderationProbe": "ok|not_attempted|failed|addon_missing" },
  "storage": { "r2Configured": true, "publicBaseUrlConfigured": false,
               "presignForProvider": "available|unavailable" },
  "jobs": { "queued": 0, "processing": 0, "paused": 0, "failedRecently": 0 },
  "blockers": ["R2_PUBLIC_BASE_URL is empty — composited output cannot be published to a public URL"] }
```

`extractionProbe`/`moderationProbe` are evaluated on demand against a known test asset and
cached briefly, because "the add-on is enabled on this account" is not something an env var can
prove. This is how the unverified Cloudinary/R2 state gets settled without anyone guessing:
the first operator to open the page learns exactly which prerequisite is missing, and the
message names the variable rather than its value.

## 8. Privacy and security

- Original photos are never publicly readable. `storage_key` resolves through the existing
  signed-read route; `contest_photo_assets` carries no public URL for `kind='original'`, and
  the provider is handed a short-lived presigned URL, not an open one.
- EXIF/GPS stripping keeps its existing `flags: stripprofile` behaviour on anything we read back
  from the vendor, and P1 adds the guarantee that the **published** asset is one we re-encoded
  with sharp — our own re-encode carries no metadata, so D-006 no longer depends on a vendor
  parameter being honoured.
- The status route authorises the job's owner; the config route requires the admin role through
  the existing `requireUser`/role helpers. No new secrets, no logging of signed URLs (the job
  stores the object key, and a fetchable URL is derived at call time and discarded).
- `last_error` is truncated before storage so a vendor response body containing a URL or token
  cannot be persisted verbatim into a table an admin can read.

## 9. Testing

Hermetic unit tests, no network, following `tests/unit/registration/photo-pipeline.test.ts` and
`tests/unit/media/cloudinary.test.ts`:

- `tests/unit/photo-jobs/job-store.test.ts` — enqueue returns the same row for the same
  `run_key` and a new row for changed `render_params`; claim honours `available_at`; backoff
  doubles and caps at 6 h; sixth failure sets `paused`; a lock older than the timeout is
  reclaimable.
- `tests/unit/photo-jobs/runner.test.ts` — happy path writes `transparent` + `final` +
  `preview` + `thumbnail` and completes; a provider failure leaves **no** `final` asset and
  marks `failed` with the message; a moderation rejection yields `cancelled` and no asset;
  the original asset row is never touched in any branch.
- `tests/unit/photo-jobs/registry.test.ts` — the relative upload route and an object key both
  resolve; a non-fetchable source enqueues a job that fails with `notFetchable` rather than
  calling the vendor with a path.
- `tests/unit/photo-jobs/review-no-overwrite.test.ts` — approving a registration whose job is
  `ready` sets `media.photoAssetId` and leaves `media.photoUrl` byte-identical; approving one
  still `queued` returns `photo_processing` and enqueues nothing a second time.

Live-database tests, in the suite that already skips without credentials
(`tests/integration/photo-jobs.test.ts`, run against the local Supabase on 54322): the
immutability trigger actually refuses an `update`/`delete` of an `original` row, the
`kind`+location unique index collapses a re-ingested duplicate onto the existing row instead of
adding a second one, RLS is on and
denies anon, `FOR UPDATE SKIP LOCKED` claims do not hand the same job to two workers, and the
partial due-index is used. **Each skip branch must be proven unreachable in the run that is
cited as evidence** — this repo has previously printed `ok` for a live suite that silently
skipped everything, so the run must report an explicit executed-test count.

Verification commands: `npm run type-check`, `vitest run tests/unit/photo-jobs`,
`npm run test:integration` with the local stack, `make rls-check`, and `supabase db push`
against the local database before any of it is claimed as applied.

## 10. Prerequisites that are not mine to satisfy

P1's code and tests will run and pass without these, and P1 is still a real improvement when
they are absent (it stops destroying the original, gives the operator a truthful status, and
names the missing configuration). Production composites, however, require owner-side actions
that I will not perform unasked:

1. Server-side `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` set on
   `frontend-web` in each environment (the `paymax` cloud already exists).
2. The background-removal and Rekognition moderation add-ons enabled on that cloud, and the
   param/response shapes in `cloudinary.ts` confirmed against a live account to close its own
   `TODO`.
3. `R2_PUBLIC_BASE_URL` (or the presigned-GET alternative in §5) configured, otherwise
   `persistToR2` throws and every render degrades to fallback.
4. Applying the migration through the normal release path, and only with the scoped
   `ops-db-push-scoped.yml` plan-then-apply pair for production.

Merging to `main` deploys production in this repo — `release.yml` has no `paths-ignore` and the
staging upload fault is fixed — so the PR will say plainly that the migration is additive and
that no behaviour changes for existing rows until the job runner is enabled by configuration.

## 11. Out of scope here

Template upload UI, drag-and-drop editing, mode A/B placement rules, blend presets and any
visual quality work (P2/P3); the contestant editor, regeneration UX, and unifying the five
rendering surfaces (P4); mobile client changes beyond surfacing a status (P4).
