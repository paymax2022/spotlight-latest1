-- Maker-checker (four-eyes) on clinical triage content & red-flag rules (SC-011).
-- Track the author (maker) of a content item / red-flag rule so the approver
-- (checker) can be required to be a different clinician at approve/publish time.
--
-- ADDITIVE-ONLY: adds a nullable-with-default column; no drop, rename, or type
-- change. Existing rows default to '' (unknown author) and are grandfathered by
-- the service (four-eyes is enforced only when created_by is known).

ALTER TABLE public.health_triage_content_items
    ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT '';

ALTER TABLE public.health_triage_red_flag_rules
    ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT '';
