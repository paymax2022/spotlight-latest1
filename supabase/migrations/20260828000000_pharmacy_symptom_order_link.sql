-- Migration: pharmacy_symptom_order_link
-- Module: Pharmacy symptom-based medication search — order ↔ search-event link
--         + evented review-case history (closes symptom-search QA risks 1/2/6).
-- Ref: contracts/openapi.yaml (POST /pharmacy/orders `search_event_id`,
--      SymptomSearchResult.search_event_id, PharmacyReviewCaseDetail),
--      supabase/migrations/20260827000000_pharmacy_symptom_search.sql.
-- Gated by FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED (default off).
--
-- ADDITIVE ONLY. No DROP TABLE / DROP COLUMN / RENAME / type narrowing
-- (DROP POLICY IF EXISTS only — the documented re-runnable pattern).
--
-- What this adds:
--   * pharmacy_review_case_events — one immutable row per review-case state
--     transition (the REAL state_history; the case row keeps only the current
--     state). Written in the SAME transaction as the state change so the
--     history can never drift from the case. from_state IS NULL marks case
--     creation; actor IS NULL marks a system transition.
--   * pharmacy_orders.search_event_id / pharmacy_review_cases.search_event_id —
--     nullable FK links to the originating symptom_search_events row so the
--     pharmacist console can show the search context (terms, concepts, cluster,
--     cohort) behind an order, and the review-case tier is resolved from the
--     ACTUAL search instead of being re-declared by the client.
--   * symptom_search_events.matched_concepts / cluster_name — resolution
--     snapshot columns so the console context needs no re-resolution (the
--     taxonomy may have changed since the search).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) pharmacy_review_case_events — evented review-case history.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pharmacy_review_case_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq        bigint GENERATED ALWAYS AS IDENTITY,  -- stable ordering inside one timestamp
  case_id    uuid NOT NULL REFERENCES public.pharmacy_review_cases(id) ON DELETE CASCADE,
  from_state text CHECK (from_state IS NULL OR from_state IN
               ('SUBMITTED','AUTO_CLEARED','PHARMACIST_REVIEW','NEEDS_INFO','APPROVED','REJECTED')),
  to_state   text NOT NULL CHECK (to_state IN
               ('SUBMITTED','AUTO_CLEARED','PHARMACIST_REVIEW','NEEDS_INFO','APPROVED','REJECTED')),
  actor      uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL ⇒ system
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_case_events_case
  ON public.pharmacy_review_case_events (case_id, created_at, seq);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) order ↔ search-event links (nullable, additive — legacy rows unaffected).
--    ON DELETE SET NULL: search events are retention-managed independently.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pharmacy_orders
  ADD COLUMN IF NOT EXISTS search_event_id uuid
    REFERENCES public.symptom_search_events(id) ON DELETE SET NULL;
ALTER TABLE public.pharmacy_review_cases
  ADD COLUMN IF NOT EXISTS search_event_id uuid
    REFERENCES public.symptom_search_events(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) resolution snapshot on the search event (console context, no re-resolve).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.symptom_search_events
  ADD COLUMN IF NOT EXISTS matched_concepts text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cluster_name text;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — mirrors pharmacy_review_cases: service_role full access,
-- admin console read. NO member read path (server-mediated surface).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pharmacy_review_case_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacy_review_case_events_service ON public.pharmacy_review_case_events;
CREATE POLICY pharmacy_review_case_events_service ON public.pharmacy_review_case_events
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS pharmacy_review_case_events_admin_read ON public.pharmacy_review_case_events;
CREATE POLICY pharmacy_review_case_events_admin_read ON public.pharmacy_review_case_events
  FOR SELECT TO authenticated USING (public.is_admin());

COMMIT;
