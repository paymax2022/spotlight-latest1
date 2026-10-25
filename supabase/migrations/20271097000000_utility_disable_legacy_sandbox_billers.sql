-- Disable four stale legacy billers from the original utility engine seed (mtn, mtn-data,
-- dstv, waec) created by 20260613100000.
--
-- They are stale duplicates of the real VTpass catalog and sort first on the
-- airtime, data and cable-tv pickers, where they are invalid choices:
--   * mtn / mtn-data  -> routed to the fake sandbox provider, not VTpass
--   * dstv            -> has no active products at all (nothing can be bought)
--   * waec            -> exact duplicate of vtpass-waec (same product, same VTpass
--                        mapping), so education lists "WAEC Result Checker" twice
--
--
-- Additive and reversible: a status flip to 'disabled' only. No rows are
-- deleted, no columns touched, and utility_transactions keeps resolving its
-- biller_id. Idempotent: re-running changes nothing. Each biller is only
-- disabled when its VTpass replacement is active, so a category can never be
-- left with an empty picker.
UPDATE public.utility_billers AS legacy
SET status = 'disabled',
    updated_at = now()
WHERE legacy.status = 'active'
  AND (legacy.code, legacy.category) IN (
        ('mtn',      'airtime'),
        ('mtn-data', 'data'),
        ('dstv',     'cable_tv'),
        ('waec',     'education')
      )
  AND EXISTS (
        SELECT 1
        FROM public.utility_billers AS replacement
        WHERE replacement.category = legacy.category
          AND replacement.status = 'active'
          AND replacement.code = CASE legacy.code
                WHEN 'mtn'      THEN 'vtpass-mtn-airtime'
                WHEN 'mtn-data' THEN 'vtpass-mtn-data'
                WHEN 'dstv'     THEN 'vtpass-dstv'
                WHEN 'waec'     THEN 'vtpass-waec'
              END
      );
