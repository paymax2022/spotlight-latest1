-- ============================================================
-- Spotlight Film Academy Hybrid Learning MVP
-- Seed initial academy programs for the LMS admin console
-- ============================================================

DO $$
DECLARE
  batch_a_id UUID;
  batch_b_id UUID;
  accelerated_batch_id UUID;
  admin_user_id UUID;
BEGIN
  SELECT id INTO batch_a_id
  FROM public.academy_batches
  WHERE batch_name = 'Batch A - 2026'
  LIMIT 1;

  SELECT id INTO batch_b_id
  FROM public.academy_batches
  WHERE batch_name = 'Batch B - 2026'
  LIMIT 1;

  SELECT id INTO accelerated_batch_id
  FROM public.academy_batches
  WHERE batch_name = 'Accelerated - 2026'
  LIMIT 1;

  SELECT id INTO admin_user_id
  FROM public.user_profiles
  WHERE lower(email) = 'admin@spotlight.internal'
  LIMIT 1;

  INSERT INTO public.academy_programs (
    title,
    slug,
    description,
    batch_id,
    sequential_completion_required,
    estimated_duration_weeks,
    is_published,
    created_by,
    updated_by
  )
  VALUES
    (
      'Screen Acting Foundations',
      'screen-acting-foundations-2026',
      'A premium foundation track for aspiring actors covering performance craft, character work, audition readiness, camera confidence, and on-set discipline before the practical studio phase.',
      batch_a_id,
      true,
      24,
      true,
      admin_user_id,
      admin_user_id
    ),
    (
      'Weekend Film Production Lab',
      'weekend-film-production-lab-2026',
      'A hybrid production program for candidates building practical capability in directing, cinematography, script breakdown, collaboration, and production workflow through a flexible weekend schedule.',
      batch_b_id,
      true,
      36,
      true,
      admin_user_id,
      admin_user_id
    ),
    (
      'Accelerated Content Creator Bootcamp',
      'accelerated-content-creator-bootcamp-2026',
      'A fast-track academy experience designed for creators who need concentrated training in storytelling, mobile production, editing, presentation, and audience-ready content delivery.',
      accelerated_batch_id,
      true,
      12,
      true,
      admin_user_id,
      admin_user_id
    )
  ON CONFLICT (slug) DO UPDATE
  SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    batch_id = EXCLUDED.batch_id,
    sequential_completion_required = EXCLUDED.sequential_completion_required,
    estimated_duration_weeks = EXCLUDED.estimated_duration_weeks,
    is_published = EXCLUDED.is_published,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW();
END $$;
