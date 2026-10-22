-- Stays UAT (STYA-D001, lane stays-a): backfill supplier refs on room types /
-- rate plans created through the hotelier extranet before refs were stamped at
-- insert time (extranet/repository.go now stamps supplier_*_ref = id::text).
-- Rows with supplier_*_ref = '' collapse every self-listed room type / rate plan
-- into one unaddressable offer and let prebook resolve an arbitrary rate plan
-- (STY-HTL-016, STY-BKH-003). Idempotent data fix; no schema change.

UPDATE public.stays_room_type
SET supplier_room_type_ref = id::text
WHERE supplier_room_type_ref = '';

UPDATE public.stays_rate_plan
SET supplier_rate_plan_ref = id::text
WHERE supplier_rate_plan_ref = '';
