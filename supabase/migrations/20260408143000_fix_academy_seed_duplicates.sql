-- ============================================================
-- Fix academy duplicate seed rows and enforce stable uniqueness
-- ============================================================

WITH ranked_settings AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY updated_at DESC, id DESC) AS row_num
  FROM public.academy_settings
  WHERE is_active = true
)
UPDATE public.academy_settings AS settings
SET is_active = false
FROM ranked_settings
WHERE settings.id = ranked_settings.id
  AND ranked_settings.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_settings_single_active
ON public.academy_settings (is_active)
WHERE is_active = true;

WITH ranked_batches AS (
  SELECT
    batch.id,
    batch.batch_name,
    ROW_NUMBER() OVER (
      PARTITION BY batch.batch_name
      ORDER BY
        (
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_programs program WHERE program.batch_id = batch.id
          ) THEN 1 ELSE 0 END
          +
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_applications application WHERE application.batch_id = batch.id
          ) THEN 1 ELSE 0 END
          +
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_enrollments enrollment WHERE enrollment.batch_id = batch.id
          ) THEN 1 ELSE 0 END
        ) DESC,
        batch.updated_at DESC,
        batch.created_at DESC,
        batch.id DESC
    ) AS row_num
  FROM public.academy_batches AS batch
),
canonical_batches AS (
  SELECT batch_name, id AS keep_id
  FROM ranked_batches
  WHERE row_num = 1
),
duplicate_batches AS (
  SELECT batch.id, canonical.keep_id
  FROM public.academy_batches AS batch
  INNER JOIN canonical_batches AS canonical
    ON canonical.batch_name = batch.batch_name
  WHERE batch.id <> canonical.keep_id
)
UPDATE public.academy_programs AS program
SET batch_id = duplicate.keep_id
FROM duplicate_batches AS duplicate
WHERE program.batch_id = duplicate.id;

WITH ranked_batches AS (
  SELECT
    batch.id,
    batch.batch_name,
    ROW_NUMBER() OVER (
      PARTITION BY batch.batch_name
      ORDER BY
        (
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_programs program WHERE program.batch_id = batch.id
          ) THEN 1 ELSE 0 END
          +
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_applications application WHERE application.batch_id = batch.id
          ) THEN 1 ELSE 0 END
          +
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_enrollments enrollment WHERE enrollment.batch_id = batch.id
          ) THEN 1 ELSE 0 END
        ) DESC,
        batch.updated_at DESC,
        batch.created_at DESC,
        batch.id DESC
    ) AS row_num
  FROM public.academy_batches AS batch
),
canonical_batches AS (
  SELECT batch_name, id AS keep_id
  FROM ranked_batches
  WHERE row_num = 1
),
duplicate_batches AS (
  SELECT batch.id, canonical.keep_id
  FROM public.academy_batches AS batch
  INNER JOIN canonical_batches AS canonical
    ON canonical.batch_name = batch.batch_name
  WHERE batch.id <> canonical.keep_id
)
UPDATE public.academy_applications AS application
SET batch_id = duplicate.keep_id
FROM duplicate_batches AS duplicate
WHERE application.batch_id = duplicate.id;

WITH ranked_batches AS (
  SELECT
    batch.id,
    batch.batch_name,
    ROW_NUMBER() OVER (
      PARTITION BY batch.batch_name
      ORDER BY
        (
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_programs program WHERE program.batch_id = batch.id
          ) THEN 1 ELSE 0 END
          +
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_applications application WHERE application.batch_id = batch.id
          ) THEN 1 ELSE 0 END
          +
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_enrollments enrollment WHERE enrollment.batch_id = batch.id
          ) THEN 1 ELSE 0 END
        ) DESC,
        batch.updated_at DESC,
        batch.created_at DESC,
        batch.id DESC
    ) AS row_num
  FROM public.academy_batches AS batch
),
canonical_batches AS (
  SELECT batch_name, id AS keep_id
  FROM ranked_batches
  WHERE row_num = 1
),
duplicate_batches AS (
  SELECT batch.id, canonical.keep_id
  FROM public.academy_batches AS batch
  INNER JOIN canonical_batches AS canonical
    ON canonical.batch_name = batch.batch_name
  WHERE batch.id <> canonical.keep_id
)
UPDATE public.academy_enrollments AS enrollment
SET batch_id = duplicate.keep_id
FROM duplicate_batches AS duplicate
WHERE enrollment.batch_id = duplicate.id;

WITH ranked_batches AS (
  SELECT
    batch.id,
    batch.batch_name,
    ROW_NUMBER() OVER (
      PARTITION BY batch.batch_name
      ORDER BY
        (
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_programs program WHERE program.batch_id = batch.id
          ) THEN 1 ELSE 0 END
          +
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_applications application WHERE application.batch_id = batch.id
          ) THEN 1 ELSE 0 END
          +
          CASE WHEN EXISTS (
            SELECT 1 FROM public.academy_enrollments enrollment WHERE enrollment.batch_id = batch.id
          ) THEN 1 ELSE 0 END
        ) DESC,
        batch.updated_at DESC,
        batch.created_at DESC,
        batch.id DESC
    ) AS row_num
  FROM public.academy_batches AS batch
)
DELETE FROM public.academy_batches AS batch
USING ranked_batches AS ranked
WHERE batch.id = ranked.id
  AND ranked.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_batches_batch_name
ON public.academy_batches (batch_name);
