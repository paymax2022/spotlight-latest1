-- ============================================================
-- Backfill competition_enrollments for legacy contestants
-- ============================================================
--
-- E2E finding F-2: the public web vote page resolves contestants from
-- public.competition_enrollments (slug, then id), but contestants promoted
-- through the legacy registration seam only ever land in public.contestants —
-- no enrollment row is ever written for them
-- (src/server/registration-v2/registration-voting.ts documents the two
-- contestant planes). With correct competition_id lookups the page still 404s
-- for every legacy contestant. This seeds enrollment rows where membership in
-- a contest is provable from existing data.
--
-- Membership evidence (all provable, nothing fabricated):
--   1. contestants.contest_id         — direct FK to contests(id)
--   2. contestants.connect_contest_id — FK to connect_contests(id), whose ids
--                                       are mirrored 1:1 from contests(id) by
--                                       20261223000000_connect_contests_bridge
--   3. contestant_votes / vote_allocations / vote_pack_purchases — hard FKs to
--      contestants(id) + contests(id); used only when both link columns are
--      NULL, as residual proof a contestant competed in a contest
--
-- Constraints honoured:
--   * enrollments.user_id is NOT NULL -> user_profiles(id). A contestant
--     without a linked user CANNOT be enrolled without minting an auth user,
--     which would be fabrication — those rows are skipped on purpose.
--   * Only roster-visible contestants are enrolled (is_active = true and not
--     disqualified), mirroring the mobile roster predicate in
--     backend/internal/connect/voting/repo.go ListRoster.
--   * enrollments.id = contestants.id. The vote page's UUID strategy resolves
--     enrollments by id, and vote_totals/votes rows for legacy contestants
--     already carry contestants.id as contestant_id — preserving the id makes
--     those tallies join without touching any existing row.
--   * slug = contestants.voting_link_slug (globally unique, hence unique per
--     contest) with a deterministic fallback; satisfies
--     uq_enrollment_contest_slug.
--   * status = 'enrolled' — the value the contestant list and vote surfaces
--     treat as roster-visible.
--
-- Idempotent: enrollment ids are the contestant ids themselves, and bare
-- ON CONFLICT DO NOTHING also absorbs the (competition_id, user_id) and
-- (competition_id, slug) unique guards, so a re-run — or an open-mic
-- enrollment that raced in first — is a no-op. Additive only: pure INSERT,
-- no UPDATE/DELETE/DDL on existing rows.
--
-- One enrollment per contestant: a contestant with several contest links gets
-- their declared contest (contest_id, then connect_contest_id); vote-derived
-- links apply only when no declared link exists.

WITH contestant_contests AS (
  -- Declared link: contestants.contest_id wins over connect_contest_id
  SELECT c.id AS contestant_id,
         1  AS evidence_rank,
         c.contest_id AS competition_id
  FROM public.contestants c
  WHERE c.contest_id IS NOT NULL

  UNION ALL

  SELECT c.id,
         2,
         c.connect_contest_id
  FROM public.contestants c
  WHERE c.contest_id IS NULL
    AND c.connect_contest_id IS NOT NULL

  UNION ALL

  -- Residual proof from vote activity, only when no declared link exists
  SELECT c.id,
         3,
         cv.contest_id
  FROM public.contestants c
  JOIN public.contestant_votes cv ON cv.contestant_id = c.id
  WHERE c.contest_id IS NULL
    AND c.connect_contest_id IS NULL
    AND cv.contest_id IS NOT NULL

  UNION ALL

  SELECT c.id,
         3,
         va.contest_id
  FROM public.contestants c
  JOIN public.vote_allocations va ON va.contestant_id = c.id
  WHERE c.contest_id IS NULL
    AND c.connect_contest_id IS NULL
    AND va.contest_id IS NOT NULL

  UNION ALL

  SELECT c.id,
         3,
         vp.contest_id
  FROM public.contestants c
  JOIN public.vote_pack_purchases vp ON vp.contestant_id = c.id
  WHERE c.contest_id IS NULL
    AND c.connect_contest_id IS NULL
    AND vp.contest_id IS NOT NULL
),
resolved AS (
  -- One row per contestant; deterministic pick = strongest evidence, then
  -- lowest competition id for a stable tiebreak across re-runs.
  SELECT DISTINCT ON (m.contestant_id)
         m.contestant_id,
         m.competition_id
  FROM contestant_contests m
  -- The derived competition id must resolve to a real contest. This also
  -- validates connect_contest_id values, which FK to connect_contests and
  -- only mirror contests by convention.
  JOIN public.contests co ON co.id = m.competition_id
  ORDER BY m.contestant_id, m.evidence_rank, m.competition_id
),
picked AS (
  -- enrollments are unique per (competition_id, user_id), not per contestant
  -- row. When one user holds two contestant rows in the same contest, pick the
  -- earliest-created contestant deterministically instead of racing the unique
  -- index.
  SELECT DISTINCT ON (r.competition_id, c.user_id)
         c.id AS contestant_id,
         r.competition_id
  FROM resolved r
  JOIN public.contestants c ON c.id = r.contestant_id
  JOIN public.user_profiles up ON up.id = c.user_id
  WHERE c.is_active = true
    AND c.is_disqualified = false
  ORDER BY r.competition_id, c.user_id, c.created_at, c.id
)
INSERT INTO public.competition_enrollments (
  id,
  competition_id,
  user_id,
  stage_name,
  legal_name,
  phone,
  email,
  state,
  genre_style,
  short_bio,
  social_links,
  profile_photo_url,
  status,
  enrolled_at,
  slug,
  metadata
)
SELECT
  c.id,
  p.competition_id,
  c.user_id,
  COALESCE(NULLIF(c.stage_name, ''), NULLIF(c.name, ''), 'Contestant'),
  COALESCE(NULLIF(c.name, ''), NULLIF(c.stage_name, ''), 'Contestant'),
  COALESCE(c.phone, ''),
  COALESCE(c.email, ''),
  COALESCE(c.state, ''),
  COALESCE(c.category, ''),
  COALESCE(c.bio, ''),
  jsonb_strip_nulls(jsonb_build_object(
    'instagram', NULLIF(c.social_instagram, ''),
    'twitter',   NULLIF(c.social_twitter, ''),
    'facebook',  NULLIF(c.social_facebook, '')
  )),
  COALESCE(c.photo_url, ''),
  'enrolled',
  c.created_at,
  COALESCE(NULLIF(c.voting_link_slug, ''), 'contestant-' || LEFT(c.id::text, 8)),
  jsonb_build_object(
    'source',          'legacy_contestant_backfill',
    'contestant_id',   c.id,
    'registration_id', c.registration_id,
    'media_url',       NULLIF(c.media_url, ''),
    'migration',       '20270322000000'
  )
FROM public.contestants c
JOIN picked p ON p.contestant_id = c.id
ON CONFLICT DO NOTHING;
