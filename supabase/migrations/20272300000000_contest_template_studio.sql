-- Contest template studio (P3): the publish columns and the four lifecycle RPCs
-- (spec §4, decisions D1 and D2).
--
-- Additive only, like P1 and P2: two nullable columns, one partial index, four
-- `create or replace function` bodies. No drop, no backfill update, no partial
-- unique index — a red `migrate staging`/`migrate production` leg is a release
-- train outage, and D2's invariant is enforced in the transaction instead.
--
-- Version note: 20272100000000 is P1, 20272200000000 is P2, and main's ceiling at
-- the time of writing is 20272000000000. Per scripts/ci/check-migration-versions.sh
-- the NEWCOMER moves: if main gains a 202723* version while PR #1182 is open,
-- renumber this file above the new maximum and re-run the merged-chain replay,
-- because `db push` silently skips a duplicate version.
--
-- D1 is why the shapes below look like they are missing an "increment version"
-- path. A published row is immutable: its `id` is inside P1's job idempotency key
-- (`job-store.ts:84-90`), so re-publishing different pixels under the same id
-- would answer a re-render from the completed row of the old template. So
-- "publish" never copies anything — it activates the draft it is handed — and a
-- new version comes into existence through `duplicate_contest_template`, which is
-- the only function here that mints an id.
--
-- p_actor: `publish` records it in `published_by`, which is the column that makes
-- "who shipped this" answerable from the row. `duplicate` records it as the new
-- draft's `created_by`. `archive` accepts it for signature symmetry and because
-- the route logs it, and deliberately does NOT store it: `contest_templates` has
-- no `archived_at`/`archived_by` column, adding two was not in §4's column list,
-- and a half-used column would be worse than an honest absence.

-- ─── the publish columns ──────────────────────────────────────────────────────
ALTER TABLE public.contest_templates
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contest_templates_parent_idx
  ON public.contest_templates (parent_template_id)
  WHERE parent_template_id IS NOT NULL;

COMMENT ON COLUMN public.contest_templates.published_at IS
  'when this row became active; NULL for every draft, which is what makes "unpublished" a fact about the row rather than a status filter';
COMMENT ON COLUMN public.contest_templates.published_by IS
  'the admin who published this row, from publish_contest_template(p_actor); ON DELETE SET NULL so removing a staff account does not orphan a template';

-- ─── duplicate: the only path to a new version id (D1) ────────────────────────
-- Copies the row verbatim plus every slot and overlay. The name is copied
-- unchanged on purpose: the version number is what distinguishes a version, and a
-- tool that rewrote "Graduation 2026" to "Graduation 2026 (v3)" would be editing
-- the admin's content, which is then what the published row says forever.
create or replace function public.duplicate_contest_template(
  p_template_id uuid,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.contest_templates%ROWTYPE;
  v_new_id uuid;
  v_slots integer;
  v_overlays integer;
begin
  -- `for share` rather than a bare read: a duplicate taken while another admin is
  -- publishing the same row would otherwise copy a version number that has since
  -- moved, and the new draft's parent link would point at the wrong tip.
  select * into v from public.contest_templates where id = p_template_id for share;
  if not found then
    raise exception 'duplicate_contest_template: no contest template % to duplicate', p_template_id
      using errcode = '22023';
  end if;

  insert into public.contest_templates (
    name, contest_id, connect_contest_id, template_url, thumbnail_url, file_format,
    width, height, aspect_ratio, status, version, parent_template_id, is_reusable,
    photo_mode, blend_preset, blend_settings, created_by, published_at, published_by
  ) values (
    v.name, v.contest_id, v.connect_contest_id, v.template_url, v.thumbnail_url, v.file_format,
    v.width, v.height, v.aspect_ratio, 'draft', v.version + 1, v.id, v.is_reusable,
    v.photo_mode, v.blend_preset, v.blend_settings, p_actor, null, null
  )
  returning id into v_new_id;

  -- All 19 authoring columns (the 15 from 20260405700000 plus P2's image_url,
  -- anchor, bleed, face_protect). Listed rather than `select s.*` so a column
  -- added later fails loudly at replay instead of silently defaulting a copied
  -- slot back to `auto`/`face_protect = true`.
  insert into public.template_slots (
    template_id, slot_name, slot_type, slot_order, x, y, width, height, rotation,
    z_index, scale, crop_mode, border_radius, opacity, snap_to_grid, grid_size,
    image_url, anchor, bleed, face_protect
  )
  select v_new_id, s.slot_name, s.slot_type, s.slot_order, s.x, s.y, s.width, s.height, s.rotation,
         s.z_index, s.scale, s.crop_mode, s.border_radius, s.opacity, s.snap_to_grid, s.grid_size,
         s.image_url, s.anchor, s.bleed, s.face_protect
    from public.template_slots s
   where s.template_id = p_template_id
   order by s.slot_order, s.z_index, s.id;
  get diagnostics v_slots = row_count;

  insert into public.template_text_overlays (
    template_id, label, field_type, content, x, y, font_size, font_weight, color, z_index
  )
  select v_new_id, o.label, o.field_type, o.content, o.x, o.y, o.font_size, o.font_weight, o.color, o.z_index
    from public.template_text_overlays o
   where o.template_id = p_template_id
   order by o.z_index, o.id;
  get diagnostics v_overlays = row_count;

  return jsonb_build_object(
    'template_id', v_new_id,
    'version', v.version + 1,
    'slot_count', v_slots,
    'overlay_count', v_overlays
  );
end;
$$;

-- ─── publish: activate one draft, archive the contest's other actives (D2) ─────
-- The single-active rule lives here rather than in a partial unique index because
-- the legacy PATCH route has already been able to activate two templates for one
-- contest, so duplicates may exist in staging or production and an index creation
-- would fail the migrate leg. Enforcing it in the transaction also makes the swap
-- atomic: no reader ever sees a contest with zero active templates.
create or replace function public.publish_contest_template(
  p_template_id uuid,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.contest_templates%ROWTYPE;
  v_archived jsonb;
begin
  select * into v from public.contest_templates where id = p_template_id for update;
  if not found then
    raise exception 'publish_contest_template: no contest template % to publish', p_template_id
      using errcode = '22023';
  end if;

  -- The renderer resolves a contest through `connect_contest_id`
  -- (`template-resolver.ts:165`). A row without one can never be read by any
  -- contest, so activating it would answer the admin "published" and change
  -- nothing a contestant can see. Refused, with the fix named.
  if v.connect_contest_id is null then
    raise exception 'publish_contest_template: template "%" (%) has no connect contest linked, so no contest can resolve it — link it to a contest first', v.name, p_template_id
      using errcode = '22023';
  end if;

  -- §10 of the P2 design: an active template with no contestant slot is
  -- unresolvable, and the pipeline drops it with a warning. Publishing one is the
  -- studio telling the admin they shipped a frame nobody can be photographed into.
  if not exists (
    select 1 from public.template_slots s
     where s.template_id = p_template_id and s.slot_type = 'contestant'
  ) then
    raise exception 'publish_contest_template: template "%" (%) has no contestant slot — add one before publishing', v.name, p_template_id
      using errcode = '22023';
  end if;

  -- Every other active row of the same contest goes to 'archived' in this same
  -- transaction. Their published_at/published_by stay in place: an archived row is
  -- history, and "when was this the live template" is a question the studio asks.
  with archived as (
    update public.contest_templates
       set status = 'archived'
     where connect_contest_id = v.connect_contest_id
       and id <> p_template_id
       and status = 'active'
    returning id
  )
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb) into v_archived from archived;

  -- No `updated_at` here: trg_contest_templates_updated_at (20260405700000:162)
  -- is a BEFORE UPDATE trigger on this table and sets it, which is the reason P1's
  -- job functions write updated_at by hand and these three do not.
  update public.contest_templates
     set status = 'active', published_at = now(), published_by = p_actor
   where id = p_template_id;

  -- Re-publishing the row that is already active is legal and reports
  -- `archived_ids = []`: it is how an admin re-times a publication after editing
  -- the draft, and refusing it would be a second rule §4 never set.
  return jsonb_build_object(
    'template_id', p_template_id,
    'version', v.version,
    'archived_ids', v_archived
  );
end;
$$;

-- ─── archive: take one row out of circulation ─────────────────────────────────
create or replace function public.archive_contest_template(
  p_template_id uuid,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.contest_templates%ROWTYPE;
begin
  select * into v from public.contest_templates where id = p_template_id for update;
  if not found then
    raise exception 'archive_contest_template: no contest template % to archive', p_template_id
      using errcode = '22023';
  end if;

  -- Idempotent by design: the studio's archive button is reachable twice, and a
  -- second press must not look like a second event. `changed` is what the route
  -- says yes/no from, so the answer does not have to be re-derived in TypeScript.
  if v.status = 'archived' then
    return jsonb_build_object('template_id', p_template_id, 'status', v.status, 'changed', false);
  end if;

  update public.contest_templates
     set status = 'archived'
   where id = p_template_id;

  -- published_at and published_by stay: they record that this row WAS live, which
  -- is the only history the versions panel has.
  return jsonb_build_object('template_id', p_template_id, 'status', 'archived', 'changed', true);
end;
$$;

-- ─── versions: the whole lineage, newest first ────────────────────────────────
-- Two recursions, not one: `parent_template_id` is a tree whose tip is not
-- necessarily the row you were handed (an admin can duplicate a draft twice), so
-- the walk goes up to the root and then back down. Both directions carry a depth
-- guard because `parent_template_id` has no cycle constraint, and a row made its
-- own ancestor by hand-edited SQL would otherwise spin this query forever.
create or replace function public.contest_template_versions(p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  with recursive up as (
    select t.id, t.parent_template_id, 0 as depth
      from public.contest_templates t
     where t.id = p_template_id
    union all
    select p.id, p.parent_template_id, u.depth + 1
      from public.contest_templates p
      join up u on p.id = u.parent_template_id
     where u.depth < 100
  ),
  root as (
    select id from up order by depth desc limit 1
  ),
  down as (
    select t.id, t.name, t.version, t.status::text as status, t.published_at, t.created_at, 0 as depth
      from public.contest_templates t
      join root r on r.id = t.id
    union all
    select c.id, c.name, c.version, c.status::text, c.published_at, c.created_at, d.depth + 1
      from public.contest_templates c
      join down d on c.parent_template_id = d.id
     where d.depth < 100
  )
  select jsonb_build_object(
    'chain', coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'version', version,
      'status', status,
      'published_at', published_at,
      'created_at', created_at
    ) order by version desc, created_at desc), '[]'::jsonb)
  ) into v from down;

  return coalesce(v, jsonb_build_object('chain', '[]'::jsonb));
end;
$$;

comment on function public.duplicate_contest_template(uuid, uuid) is
  'P3 D1: mints the next version as a new draft row (new id, version+1, parent set) and copies every slot and overlay. Returns {template_id, version, slot_count, overlay_count}';
comment on function public.publish_contest_template(uuid, uuid) is
  'P3 D2: activates the given draft, archiving every other active row of the same connect_contest_id in the same transaction. Refuses a missing link or a missing contestant slot with 22023. Returns {template_id, version, archived_ids}';
comment on function public.archive_contest_template(uuid, uuid) is
  'Takes one row out of circulation, leaving published_at/published_by as history. Idempotent: reports {changed:false} on the second press. Returns {template_id, status, changed}';
comment on function public.contest_template_versions(uuid) is
  'The whole lineage of a template, root and siblings, ordered by version descending. Returns {chain:[{id,name,version,status,published_at,created_at}]}';

-- Privileges, following P1's tail (20272100000000:357-395) and the reason it
-- recorded there: this schema's ALTER DEFAULT PRIVILEGES hand EXECUTE to anon,
-- authenticated and service_role for every new function, so `revoke … from public`
-- alone is not enough. These four mutate the table the live gallery reads, so the
-- only caller is the BFF arriving as service_role, behind the route's
-- assertAdminPermission(request, 'votes:manage').
revoke all on function public.duplicate_contest_template(uuid, uuid) from public, anon, authenticated;
revoke all on function public.publish_contest_template(uuid, uuid) from public, anon, authenticated;
revoke all on function public.archive_contest_template(uuid, uuid) from public, anon, authenticated;
revoke all on function public.contest_template_versions(uuid) from public, anon, authenticated;

grant execute on function public.duplicate_contest_template(uuid, uuid) to service_role;
grant execute on function public.publish_contest_template(uuid, uuid) to service_role;
grant execute on function public.archive_contest_template(uuid, uuid) to service_role;
grant execute on function public.contest_template_versions(uuid) to service_role;
