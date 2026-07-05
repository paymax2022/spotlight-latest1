-- Migration: pharmacy_symptom_hardening
-- Module: Pharmacy symptom-based medication search — go-live hardening:
--         (1) server-side rolling-window quantity caps (PRD §5.5),
--         (2) NDPR retention purge for symptom_search_events (PRD §5.4),
--         (3) indexes backing the cap-window query and the safety-metrics
--             endpoint (PRD §9).
-- Ref: contracts/openapi.yaml (QuantityCapError, SymptomSafetyMetrics,
--      /admin/pharmacy/symptom/metrics, PharmacySkuOption.qty_window_days),
--      supabase/migrations/20260827000000_pharmacy_symptom_search.sql,
--      supabase/migrations/20260828000000_pharmacy_symptom_order_link.sql.
-- Gated by FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED (default off).
--
-- ADDITIVE ONLY. No DROP TABLE / DROP COLUMN / RENAME / type narrowing.
-- (CREATE OR REPLACE FUNCTION on a NEW function name is additive.)

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Quantity-cap window semantics (PRD §5.5).
--    20260827 defined pharmacy_skus.max_qty_per_window with no window-length
--    column — the window was implicit. Make it explicit and per-SKU:
--    qty_window_days (default 30 — the PRD's "per month" reading). The cap is
--    enforced SERVER-SIDE in pharmacy CreateOrder (fail-closed, before the
--    escrow hold); the mobile stepper cap is cosmetic only.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pharmacy_skus
  ADD COLUMN IF NOT EXISTS qty_window_days integer NOT NULL DEFAULT 30
    CHECK (qty_window_days > 0);

-- Cap lookup: "the strictest capped SKU of this product" (order lines are
-- product-keyed; SKU commerce attributes live on pharmacy_skus).
CREATE INDEX IF NOT EXISTS idx_pharmacy_skus_capped_product
  ON public.pharmacy_skus (product_id, max_qty_per_window)
  WHERE active = true AND max_qty_per_window IS NOT NULL;

-- Window sum: the user's ordered quantity for a product across the rolling
-- window (excluding CANCELLED / REFUNDED orders).
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_patient_created
  ON public.pharmacy_orders (patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pharmacy_order_lines_order_product
  ON public.pharmacy_order_lines (order_id, product_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) NDPR retention purge (PRD §5.4 — symptom queries are sensitive health
--    data and retention-limited). Deletes symptom_search_events older than
--    retention_days. Linked rows are NOT orphaned: pharmacy_orders.search_event_id
--    and pharmacy_review_cases.search_event_id are ON DELETE SET NULL
--    (20260828), so purged events simply unlink from orders/cases.
--    SECURITY DEFINER + service_role-only EXECUTE — the Go backend invokes it
--    on a daily background loop (symptomsearch.StartRetentionPurge; the repo
--    has no pg_cron and no asynq periodic scheduler — background tickers are
--    the house pattern, e.g. orchestration.StartReconScheduler).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pharmacy_symptom_events_purge(retention_days integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted integer;
BEGIN
  IF retention_days IS NULL OR retention_days < 1 THEN
    RAISE EXCEPTION 'pharmacy_symptom_events_purge: retention_days must be >= 1 (got %)', retention_days;
  END IF;
  DELETE FROM public.symptom_search_events
  WHERE created_at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_symptom_events_purge(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pharmacy_symptom_events_purge(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_symptom_events_purge(integer) TO service_role;

-- Purge + metrics (searches_24h / gated_share_7d) both scan by created_at.
CREATE INDEX IF NOT EXISTS idx_symptom_events_created
  ON public.symptom_search_events (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Safety-metrics support (PRD §9): 7-day case rollups scan created_at;
--    median decision latency scans decision events by to_state + created_at.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_review_cases_created
  ON public.pharmacy_review_cases (created_at);
CREATE INDEX IF NOT EXISTS idx_review_case_events_decisions
  ON public.pharmacy_review_case_events (created_at)
  WHERE to_state IN ('APPROVED','REJECTED');

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS check (no change, re-asserted for the audit trail): symptom_search_events
-- keeps ONLY the service_role policy from 20260827 — no authenticated/admin
-- read path exists on the raw query log (NDPR). This migration adds none.
-- ─────────────────────────────────────────────────────────────────────────────

COMMIT;
