# Contest template studio — design (P3)

Status: derived from the approved master spec's phase table
(`docs/superpowers/specs/2026-11-26-contest-photo-assets-and-jobs-design.md:19`), which defines P3 as
"Admin template studio: real upload, visual slot editing, sample-portrait preview,
draft/publish/versioning — §4, §8, admin workflow steps 1-6 — depends on P1".
Owner of implementation: `frontend-web` (Next.js BFF + renderer), `frontend-admin` (the authoring
screen), `supabase/migrations`.
Depends on P1 (assets + durable jobs + provider seam) and P2 (the blend engine and the template
columns it reads). Both are unlanded; this is the third PR of the stack.

## 1. Why P3 has to start by fixing something P2 could not see

P2 shipped a blend engine that reads `blend_preset`, `blend_settings`, `photo_mode`, `anchor`,
`bleed`, `face_protect` and `slot.image_url` and nothing in the tree writes any of them:

```
grep -rln "blend_preset\|blend_settings\|photo_mode\|face_protect" --include="*.ts" --include="*.tsx" --include="*.sql" .
  → the migration, template-resolver.ts (the reader), imageCompositor.ts, blend/*.ts, and tests only
```

So the studio is the phase that first makes those columns reachable. And the moment it does, it
discovers a defect that neither P1 nor P2 could observe, because neither of them ever had a template
to composite onto in a real environment:

**A template image stored in our own bucket cannot be read by any compositing path.**

Traced, not inferred:

| Step | Code | What it does with a Supabase template URL |
|---|---|---|
| Admin uploads | `app/api/admin/voting/contest-templates/route.ts:205-227` | key `templates/<contest>/<uuid>.<ext>`, then `getPublicUrl` → `https://<project>.supabase.co/storage/v1/object/public/contest-templates/…` (`frontend-web/.env.example:14` is that shape) |
| P2's blend pass | `src/server/photo-jobs/runner.ts:120-131` | `readAssetBytes({ provider_url: template.templateUrl })` |
| The read | `src/server/photo-jobs/assets.ts:31-42` | `fetchAllowed` → `if (!isAllowedRemoteImageUrl(url)) return null` |
| The policy | `src/lib/config/index.ts:89-101` + `:75-88` | https **and** hostname ∈ {images.unsplash.com, images.pexels.com, images.pixabay.com, img.rocket.new, res.cloudinary.com} |
| The outcome | `runner.ts:133-138` | bytes null → paste-only render, record `{applied:false, error:'the cutout or template bytes could not be read'}` |
| The pre-P1 path | `src/lib/rendering/imageCompositor.ts:123-131` | `fetchImageBuffer` throws `Remote image host is not allowed: <url>` on the same URL |

The predicate is a closed `as const` list; `<project>.supabase.co` is not in it, and neither is a
self-hosted Supabase origin or a local `http://localhost:54321`. So today no environment can render
an admin-uploaded template: the queued job degrades to a paste, and the synchronous pre-P1 pipeline
throws. It has stayed invisible because the resolver answers `noTemplate` for every contest until an
admin publishes one — the master spec's own line for that state is "the template studio is P3"
(`src/server/photo-jobs/registry.ts:113-120`).

Why the tests did not catch it: `tests/unit/photo-jobs/blend/runner-blend.test.ts:39,56,120` mocks
`readAssetBytes` and hands the resolver a `https://cdn.test/template.png`, so the real predicate is
never consulted. The fix is therefore (a) a unit that reads template bytes correctly, (b) a test that
runs the real predicate against the real URL shape, and (c) a config-status probe so the fault cannot
return silently (P2's precedent: an engine that always declines is indistinguishable from an engine
that was never configured).

Rejected for this defect: **widening `allowedRemoteImageHostnames` to include the Supabase host.**
That list is an SSRF guard whose whole value is that it is closed and short; adding "whatever
`NEXT_PUBLIC_SUPABASE_URL` says" makes it env-derived, and once the host is allowed every path in
every bucket of that project becomes fetchable by an image URL that anyone can write into a text
column. Also rejected: **copying template images into R2** — it puts the same bytes in two storage
planes and needs a migration of existing rows. Chosen instead: a read unit that recognises *our own*
storage by exact origin match plus bucket allowlist and downloads through the admin client, and
falls back to the existing allowlisted fetch for anything else (Cloudinary-hosted templates, and the
`cdn.test`-style URLs the P2 tests already use, keep working unchanged).

## 2. Decisions, and the alternatives rejected

**D1 — A published template row is immutable; a new version is a new row.**
`contest_templates` already carries `version INTEGER NOT NULL DEFAULT 1` and
`parent_template_id UUID REFERENCES contest_templates(id)` (`20260405700000_contest_image_templates.sql:94-95`)
and nothing has ever written them. P3 uses them as designed: editing happens on a `draft`, and
"publish" makes that row `active`; editing an `active` template means "save as new version", which
copies the row (new id, `version = parent.version + 1`, `parent_template_id = parent.id`) into a draft
and leaves the published row untouched.
*Why this and not an in-place version bump:* the job queue's idempotency key is
`photo:<source_asset_id>:<template_id>:<render_hash>` (`job-store.ts:84-90`) — **version is not in
it**. Bumping `version` on the same id would answer a re-render of a changed template from the
completed row of the old one, which is exactly the fault P2's resolver doc names
(`template-resolver.ts:69-81`). A new id changes the key with no change to P1's contract, and it
keeps every past `contest_photo_assets.template_id/template_version` pointing at a row that still
says what produced that image. Rejected alternative: put `template_version` into `buildRunKey` — it
touches P1's proven queue semantics, re-keys every historical run, and buys nothing that row-identity
does not already buy.

**D2 — Exactly one active template per contest, enforced in the publish RPC, not by a unique index.**
`publish_contest_template` archives every other `active` row for the same `connect_contest_id` in the
same transaction, then activates the target. Rejected: `create unique index … where status = 'active'`
— the current `PATCH` route lets an admin activate two templates for one contest and does so today
without archiving anything, so a duplicate may already exist in staging or production; a failed
`migrate staging`/`migrate production` leg is an outage of the release train, and this repo's history
says a red migration leg is expensive. The invariant is proven live-DB instead (§9) and the index can
be added once someone measures the deployed rows.

**D3 — Preview is a synchronous route that returns bytes; it is not a job and it writes nothing.**
`POST /api/admin/voting/contest-templates/[id]/preview` (multipart) runs the same renderer the runner
runs and answers the image. Rejected: queueing a job — a preview has no registration, no contestant,
no original asset, and the queue is the lineage of real renders; rejected: storing previews as
`kind='preview'` asset rows — that table would fill with abandoned design attempts, and the
insert-only immutability rule makes them permanent. Returning bytes also means no new bucket, no
signed URL, and nothing to clean up.

**D4 — The sample portrait is supplied by the admin, never taken from a contestant.**
Master spec §8 keeps contestant photographs in PII scope. The preview accepts one image; if it has
alpha it is used directly, if it is fully opaque it goes through P1's provider seam
(`getPhotoProvider().extractBackground`) when one is configured, and when neither works the route
answers 415 with the fix in the sentence. No contestant's `registration_id` is ever consulted by this
path, which is the property a test can hold.

**D5 — `blend_settings` is validated against the bounds in `blend/params.ts`, not a second table.**
The API refuses an unknown key and a non-number, and answers with `effective_params` — the
`BlendParams` `resolveBlendParams` will actually use for that save. `params.ts:12-16` already states
the rule ("an override may narrow a bound but never pass it"); a form that silently stored an
out-of-range value would be writing rendering policy, so the admin sees the clamped number instead of
a surprise.

**D6 — Studio fields are writable on `draft` rows only.**
`PATCH`/slots writes on an `active` row answer 409 `template_is_published` pointing at "save as new
version", which is D1 made visible. `PATCH status:'active'` keeps working for old callers but now
delegates to the publish RPC, so it gets D2's archiving for free rather than minting a second active
template.

## 3. What already exists, verified from the tree

- `app/api/admin/voting/contest-templates/route.ts` — GET list (templates + slots + overlays in one
  call), POST create (multipart → bucket upload → `status:'draft'`, orphan cleanup when the insert
  fails, `describeStorageFailure`/`describeInsertFailure` naming every refusal). Real upload exists;
  it is the studio fields and the byte read that do not.
- `[templateId]/route.ts` — GET one, PATCH (name/status/width/height/aspectRatio only), DELETE (409
  while active).
- `[templateId]/slots/route.ts` — PUT replaces the whole list. It validates the 13 pre-P2 fields and
  writes those; `anchor`, `bleed`, `face_protect`, `image_url` are **silently dropped** — not rejected,
  dropped, so an author cannot tell.
- `_shared.ts` — `mapTemplateRow` exposes `version` and `parentTemplateId`; `mapSlotRow` exposes none
  of the four P2 slot fields. `hasContestantSlot` is the activate guard.
- `frontend-admin/app/admin/voting/templates/page.tsx` (471 lines) + `src/services/contestTemplatesService.ts` —
  list/create/edit/delete plus a numeric slot editor with a proportionally scaled overlay box. Path A:
  it talks to the frontend-web BFF through `/api/web-proxy`, gated on `votes:manage`.
- `src/lib/rendering/blend/` — `params.ts` (presets + BOUNDS + `resolveBlendParams`), `placement.ts`
  (`planPlacement`, `resolvePhotoMode`), `subject-metrics.ts`, `edge-refine.ts`, `light-match.ts`,
  `shadow.ts`, `face-safe.ts`, `index.ts` (`blendSubject(BlendRequest) → BlendOutput`).
- `runner.ts chooseRender` (private) — the only existing caller that turns (template bytes, subject
  bytes, params, photo_mode, slot) into a `CompositorInput` + decisions record. P3 reuses it rather
  than paraphrasing it: a second copy of that wiring is the "runner that can disagree with the
  registry" problem `template-resolver.ts:15-22` warns about.
- `app/api/admin/photo-config-status/route.ts` — the P1 observability surface P3 extends.
- `scripts/ci/check-migration-versions.sh` — the newcomer rule; `origin/main`'s ceiling is
  `20272000000000`, the stack adds `202721…` (P1) and `202722…` (P2), so P3 takes `20272300000000`.

## 4. Data model

One forward-only additive migration: `supabase/migrations/20272300000000_contest_template_studio.sql`.

```sql
ALTER TABLE public.contest_templates
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid;
CREATE INDEX IF NOT EXISTS contest_templates_parent_idx
  ON public.contest_templates (parent_template_id)
  WHERE parent_template_id is not null;
COMMENT ON COLUMN public.contest_templates.published_at IS
  'when this row became active; NULL for every draft, which is what makes "unpublished" a fact about the row rather than a status filter';
```

Four RPCs, house style (`security` via `revoke … from public, anon, authenticated` + `grant execute …
to service_role`, fully-qualified names, `jsonb` answers), all taking `p_actor uuid` so the row says
who published it:

| Function | Contract |
|---|---|
| `duplicate_contest_template(p_template_id uuid, p_actor uuid)` | Copy the row verbatim except: `version = parent.version + 1`, `parent_template_id = p_template_id`, `status = 'draft'`, `published_at/by = null`. The name is copied as-is — the version number is what distinguishes a version, and rewriting the admin's name would be the tool editing their content. Then copy every `template_slots` row (all 17 columns, including the four P2 fields) and every `template_text_overlays` row. Returns `{template_id, version, slot_count}`. Refuses a `p_template_id` that does not exist with `errcode 22023`. |
| `publish_contest_template(p_template_id uuid, p_actor uuid)` | Lock the row `for update`; refuse when it has no `slot_type='contestant'` slot (`22023`, message names the template); set every *other* active row for the same `connect_contest_id` to `archived`; set this row `status='active', published_at=now(), published_by=p_actor`. Returns `{template_id, version, archived_ids}` — the list is what makes the swap auditable in one round trip. |
| `archive_contest_template(p_template_id uuid, p_actor uuid)` | `status='archived'`; leaves `published_at` in place as history. Returns `{template_id, status}`. |
| `contest_template_versions(p_template_id uuid)` | Walk `parent_template_id` both ways and return `{chain:[{id,name,version,status,published_at,created_at}]}` ordered by version descending. A function rather than a route-side loop because Postgres owns the recursion (`with recursive`). |

No RLS changes: both tables already have RLS from `20260405700000`, and the RPCs run as the migration
owner (the same arrangement P1's `enqueue_photo_job` relies on), reached only through routes that call
`assertAdminPermission(request, 'votes:manage')` first.

## 5. Code layout

New, one job each:

- `frontend-web/src/lib/media/template-image.ts` — **reads a template's bytes, whoever hosts them.**
  `export async function readTemplateImage(value: string): Promise<{ok:true; bytes:Buffer; source:'storage'|'remote'} | {ok:false; reason:string}>`.
  Own-storage branch: `new URL(value)` origin must equal `new URL(NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_URL).origin`
  (exact match, not a suffix — a suffix match lets `evil-supabase.co.attacker.tld` through) and the
  path must be `/storage/v1/object/public/<bucket>/<key>` with bucket ∈ `TEMPLATE_READ_BUCKETS = ['contest-templates']`;
  then `createAdminClient().storage.from(bucket).download(key)`. Everything else falls through to the
  existing `isAllowedRemoteImageUrl` fetch. Both branches report a reason the admin can act on.
- `frontend-web/src/lib/rendering/blend/composite.ts` — the extraction of `chooseRender`'s core:
  `export async function compositeWithBlend(input: {templatePng: Buffer; canvas: CanvasSize; slot: SlotConfig; foregroundSlots: SlotConfig[]; subjectPng: Buffer; params: BlendParams; photoMode?: string; overrides?: BlendOverrides}): Promise<{buffer: Buffer; mimeType: string; width: number; height: number; decisions: Record<string, unknown>}>`.
  `runner.ts`'s `chooseRender` keeps its byte-reading and its degradation policy and calls this for the
  maths; `isBlendDisabled` stays in the runner so preset `off` still reaches P1's exact
  `compositeImage` call and §14.11's byte-identity test is untouched.
- `frontend-web/src/server/template-studio/authoring.ts` — the field layer both the create and the
  PATCH/slots routes use: `parseStudioTemplateFields(body) → {ok, updates} | {ok:false, code, message}`,
  `parseStudioSlotFields(raw) → {ok, row} | {ok:false,…}`, `effectiveBlendParams(preset, settings)`.
- `frontend-web/src/server/template-studio/preview.ts` — `renderPreview({templateUrl, template canvas,
  slot, foregroundSlots, preset, settings, photoMode, subjectBytes})` → the composite, via
  `readTemplateImage` + `compositeWithBlend`. Alpha detection uses `measureSubject`; an opaque subject is
  offered to `getPhotoProvider()`.
- `frontend-web/src/server/template-studio/lifecycle.ts` — the four RPCs' thin wrappers (`duplicate`,
  `publish`, `archive`, `versions`) with one error shape.
- `frontend-web/app/api/admin/voting/contest-templates/[templateId]/{preview,duplicate,publish,archive,versions}/route.ts` —
  five new routes, each: `assertAdminPermission` → lifecycle/preview call → named errors.
- `frontend-admin/src/services/contestTemplatesService.ts` — the studio fields on the template and
  slot types, plus `publishTemplate/duplicateTemplate/archiveTemplate/listVersions/previewTemplate` and
  a re-export of the server's bounds so the sliders cannot offer an illegal value.
- `frontend-admin/app/admin/voting/templates/page.tsx` — a Blend panel on the editor: preset select,
  the four clamped overrides that matter to an author (feather, light-match strength, shadow on/off,
  face protect), `photo_mode` + `anchor` + `bleed` on the contestant slot, Save / Save as new version /
  Publish / Archive buttons, and a "Preview with sample photo" file input that paints the returned
  image next to the frame. Numeric slot fields stay: the drag canvas is P3b (§10).

## 6. API surface

| Call | Request | Response | Refusals |
|---|---|---|---|
| `POST /api/admin/voting/contest-templates` | existing multipart + `photoMode`, `blendPreset`, `blendSettings` (JSON string) | `201 {success, template}` where `template.effectiveParams` is the resolved `BlendParams` | existing codes + `blend_preset_invalid`, `blend_setting_unknown`, `blend_setting_not_a_number` (400) |
| `PATCH /api/admin/voting/contest-templates/[id]` | existing + the same three studio fields | `{success, template, effectiveParams}` | 409 `template_is_published` when the row is `active` and a studio field is being written; `blend_*` as above |
| `PUT …/[id]/slots` | slot objects gain `imageUrl`, `anchor`, `bleed`, `faceProtect` | `{success, slots}` (each slot now round-trips the four) | 400 `slot_anchor_invalid`; 400 `slot_image_url_on_contestant` (P2: the contestant slot's art is the person, not a file); 409 `template_is_published` |

`PUT` replaces the whole list, so an omitted studio field has to mean something. The rule: a slot
carrying an existing `id` keeps the stored value for any of the four fields the payload leaves out
(the route reads the current rows first), and a slot without an `id` gets the column default
(`anchor:'auto'`, `bleed:false`, `face_protect:true`, `image_url:null`). A missing field is therefore
never a silent reset — which matters because the current numeric editor sends 13 fields and knows
nothing about these four.

| Call (continued) | Request | Response | Refusals |
| `POST …/[id]/preview` | multipart: `file` (sample portrait, required), optional overrides of `blendPreset`, `blendSettings`, `photoMode`, `x/y/width/height/anchor/bleed/faceProtect` so the admin can preview **unsaved** edits | `200 image/jpeg` or `image/png` bytes with `X-Blend-Applied: true|false` and `X-Render-Decisions: <json>` | 415 `sample_needs_cutout` (opaque + no provider), 415 `sample_unreadable`, 502 `template_bytes_unreadable: <reason>`, 400 `canvas_too_large` (side > 4096) |
| `POST …/[id]/duplicate` | empty body | `201 {success, template}` (the new draft, with its slots) | 404, 502 `template_duplicate_failed` |
| `POST …/[id]/publish` | empty body | `{success, template, archived:[…]}` | 400 `publish_needs_contestant_slot`, 404 |
| `POST …/[id]/archive` | empty body | `{success, template}` | 404 |
| `GET …/[id]/versions` | — | `{success, chain:[…]}` | 404 |
| `GET /api/admin/photo-config-status` | — | now also `templateBytes: {sampledTemplateId, ok, reason?, source}` | — |

Errors keep the house rule: machine `code` + a sentence that names the fix, because these land in a
console banner and the master spec's §7 lesson was that a bare "Failed to upload" tells an admin
nothing.

## 7. Flow — the attached spec's admin workflow steps 1-6

1. *Upload a template image* — existing POST, now answering the probed `width/height` (sharp metadata
   on the bytes we already hold, instead of trusting hand-typed numbers) and a draft `effectiveParams`.
2. *Mark the photo area* — P3 keeps this declarative: `photo_mode` ∈ `auto|background|photo_area`, and
   `auto` is honest because `resolvePhotoMode` reads the template's own alpha. (The canvas where an
   admin draws the window is P3b.)
3. *Position the contestant* — slot x/y/w/h (numeric now, dragged in P3b) + `anchor` + `bleed`.
4. *Choose the blend* — preset + the bounded overrides, each save echoing `effectiveParams`.
5. *Preview with a sample portrait* — the preview route, with the unsaved edits in the same request.
6. *Publish* — `publish`, which archives the previous active row and records who/when, and whose
   `archived:[…]` is what makes the swap reviewable. Rollback afterwards is `publish` on the parent.

## 8. Failure handling

Nothing in P3 turns a design-tool failure into a contestant-visible failure. Concretely: the preview
route owns its errors and never writes a row; the publish RPC's refusals are the existing activate
guard expressed once; a template whose bytes cannot be read produces a 502 that names the reason and
the host, and the same fact is visible on `photo-config-status` without an admin having to try.
The runner keeps P2's §10 degradation rule exactly as written: an engine that throws, or bytes that
could not be read, renders P1's paste and records why. What changes is that the common case stops
being "bytes could not be read".

## 9. Testing

| What | Where | Which lane actually runs it |
|---|---|---|
| `readTemplateImage` accepts our own storage URL and refuses a look-alike origin; `isAllowedRemoteImageUrl` on the real URL shape (the §1 red test) | `frontend-web/tests/unit/media/template-image.test.ts` | frontend-web unit lanes (vitest, no DB) |
| The runner's blend branch now receives real bytes: a test that fails on today's `provider_url` read | `frontend-web/tests/unit/photo-jobs/blend/runner-blend.test.ts` (extended, mocks kept, plus an unmocked predicate case) | frontend-web unit lanes |
| `compositeWithBlend` == the old `chooseRender` output for the same input, and preset `off` still short-circuits | `frontend-web/tests/unit/rendering/blend-composite.test.ts` + the existing §14.11 byte-identity spec must stay green | frontend-web unit lanes |
| Authoring validation (studio fields, 409 on published rows, slot round-trip, all error codes) | `frontend-web/tests/unit/voting/contest-templates-studio.test.ts` (same fake-client pattern as `contest-templates-admin-api.test.ts`) | frontend-web unit lanes |
| The four RPCs: single-active invariant, version/parent chain, slots copied, publish-without-contestant-slot refused | `backend/tests/contests/template_studio_live_db_test.go`, `TestLiveDB…` naming, `TEST_DATABASE_URL` gate | `live-DB suites (Postgres + migrations)` (`ci.yml:440-507`) **and** `integration-verify` |
| Preview renders and answers its headers; opaque sample without a provider answers 415 | `frontend-web/tests/unit/voting/contest-template-preview.test.ts` | frontend-web unit lanes |
| Admin service bounds mirror the server's, so the UI cannot offer an illegal slider value | `frontend-admin/tests/admin/contest-template-studio.spec.ts` | frontend-admin `vitest run` |

Lane placement is not incidental and is stated in the PR: `make migrate-reset` (a fresh replay of the
whole chain) runs as step 14 of `integration-verify.yml`, and the Go live-DB suites run in both that
lane and `ci.yml`'s live-DB job, so the RPC proofs are executed by CI rather than only by me. The JS
specs in `frontend-web/tests/integration/` still have **no lane** (P2 correction 28), which is why
nothing new goes there.

## 10. Deliberately not in this sub-project

- **The drag-and-drop canvas** (moving/resizing the slot by pointing, and drawing the photo window).
  It is a React interaction on the same contract this PR builds, large enough to be its own slice
  (P3b), and the numeric editor plus the preview already makes an author's job finishable.
- **Text overlay editing** — no write route exists today and P2's resolver does not read
  `template_text_overlays` at all, so the new pipeline cannot honour them; that is a separate gap,
  recorded in §11 rather than quietly left out.
- The contestant editor, `USE THIS PHOTO`, re-render with new params (P4).
- Making the historical data conform to one-active-per-contest, and the partial unique index that
  would enforce it (D2).

## 11. Gaps found, not fixed (so the next reader does not re-find them)

1. `template_text_overlays` is written by nothing and read by nothing in the photo pipeline: the
   resolver's `TEMPLATE_COLUMNS`/`SLOT_COLUMNS` (`template-resolver.ts:56-59`) do not include them, so
   a composite through the job queue has no text layer. The pre-P1 `photo-pipeline.ts` path does pass
   overlays, so the two renderers are not equivalent — P3b/P4 needs to decide which is authoritative.
2. `frontend-web/tests/integration/**` has no CI lane (P2 correction 28): `npm run test:integration`
   is defined and referenced nowhere. P3's RPC proofs therefore go to Go live-DB tests instead.
3. `isAllowedRemoteImageUrl` is a closed list with no env hook. Any future feature that composites a
   template from a new host will hit §1 again; the right fix then is the same `readTemplateImage`
   branch, not a longer list.

## 12. Rollout and rollback

Additive migration; no existing row changes meaning, `published_at/by` are NULL on every row today.
**The behaviour change is real and is stated plainly:** the instant a template is published, blends
start applying, because `blend_preset` defaults to `natural` (`20272200000000:26`) and until this PR
the bytes could not be read. Nothing regresses — no environment produced a blended render before —
but the first published template changes output pixels for new renders.
Kill switch, per template: `PATCH blendPreset:'off'` (byte-identical to P1's paste by §14.11), or
`update contest_templates set blend_preset='off' where id = …` for a row that is already active.
Full stop: unpublish (`POST …/archive`), which returns the contest to `noTemplate` → the registry
records the original and queues nothing.
Merging to `main` is a production release in this repo, so integration stays the owner's call.
