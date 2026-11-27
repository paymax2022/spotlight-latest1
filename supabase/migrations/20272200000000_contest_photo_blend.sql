-- Contest photo blend layer (P2): the columns the renderer reads.
-- Additive only; every default keeps today's behaviour reachable.
--
-- Version note: 20272100000000 is P1's photo asset/job table and
-- 20272000000000 is main's locality_villages. Per
-- scripts/ci/check-migration-versions.sh the NEWCOMER moves: if `main` gains a
-- 202722* version while this PR is open, renumber this file to a version after
-- the new maximum and re-run the merged-chain replay in Task 11 Step 4 — a
-- duplicate version is silently skipped by `db push`, which is a post-merge
-- outage rather than a pre-merge error.
--
-- Defaults are the load-bearing part of this file. 'auto' lets the resolver
-- decide the mode from the template's own alpha instead of forcing every
-- existing template down one path; 'natural' is the preset whose numbers were
-- measured against the spec's reference renders; face_protect defaults to true
-- because a banner crossing a contestant's eyes is the failure an admin will
-- not notice until the gallery is public.
ALTER TABLE public.contest_templates
  ADD COLUMN IF NOT EXISTS photo_mode text NOT NULL DEFAULT 'auto'
    CHECK (photo_mode IN ('auto', 'background', 'photo_area')),
  ADD COLUMN IF NOT EXISTS blend_preset text NOT NULL DEFAULT 'natural'
    CHECK (blend_preset IN ('natural', 'studio', 'bold', 'off')),
  ADD COLUMN IF NOT EXISTS blend_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.template_slots
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS anchor text NOT NULL DEFAULT 'auto'
    CHECK (anchor IN ('auto', 'top', 'centre', 'bottom')),
  ADD COLUMN IF NOT EXISTS bleed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS face_protect boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.contest_templates.photo_mode IS
  'auto = decide from the template alpha; background = full-bleed subject behind the frame; photo_area = fit inside the slot window';
COMMENT ON COLUMN public.contest_templates.blend_preset IS
  'natural|studio|bold|off. off renders exactly the pre-P2 compositor and records applied:false';
COMMENT ON COLUMN public.contest_templates.blend_settings IS
  'per-template overrides of the preset table, re-clamped on read by resolveBlendParams';
COMMENT ON COLUMN public.template_slots.image_url IS
  'fixed artwork for a non-contestant slot; NULL for the contestant slot';
