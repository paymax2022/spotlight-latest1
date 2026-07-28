-- Dedupe Ikeja Electric DISCO.
--
-- Two active electricity billers exist for the same DISCO:
--   • ikeja-electric        (canonical — keep)
--   • vtpass-ikeja-electric (duplicate — disable)
-- This produced two identical "Ikeja Electric" tiles on the electricity payment
-- screen. We keep the canonical `ikeja-electric` and retire the vtpass duplicate.
--
-- Additive & reversible (per the additive-only migration rule): the row is NOT
-- deleted — it is flagged status='disabled'. The app's DISCO query filters on
-- status='active', so the duplicate simply stops appearing. The guard ensures we
-- never disable the duplicate unless the canonical biller is present and active,
-- so Ikeja Electric is never left without an option.
UPDATE public.utility_billers AS dup
SET    status = 'disabled',
       updated_at = now()
WHERE  dup.category = 'electricity'
  AND  dup.code = 'vtpass-ikeja-electric'
  AND  dup.status = 'active'
  AND  EXISTS (
         SELECT 1
         FROM   public.utility_billers keep
         WHERE  keep.category = 'electricity'
           AND  keep.code = 'ikeja-electric'
           AND  keep.status = 'active'
       );
