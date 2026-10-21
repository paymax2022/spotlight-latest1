-- PENDING (orchestrator applies + renumbers at consolidation; lanes do not migrate).
-- STYA-D001: backfill supplier refs on room types / rate plans that were created
-- through the hotelier extranet before refs were stamped at insert time
-- (extranet/repository.go now stamps supplier_*_ref = id::text on create).
-- Without this, rows carry supplier_*_ref = '' which collapses every
-- self-listed room type/rate plan into one unaddressable offer and lets
-- prebook resolve an arbitrary rate plan (STY-HTL-016, STY-BKH-003).
-- ADDITIVE-ONLY data fix; idempotent.

BEGIN;

UPDATE public.stays_room_type
SET supplier_room_type_ref = id::text
WHERE supplier_room_type_ref = '';

UPDATE public.stays_rate_plan
SET supplier_rate_plan_ref = id::text
WHERE supplier_rate_plan_ref = '';

COMMIT;
