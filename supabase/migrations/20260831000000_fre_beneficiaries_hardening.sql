-- ── Fractional RE hardening: beneficiaries + secondary-listing idempotency +
-- auto-invest execution + limit-override reason codes ────────────────────────
-- Additive-only migration for internal/fractionalre (audit work orders 1,3,4,7).
-- Iron rules honoured:
--   * All monetary amounts are integers in MINOR units (kobo). Never floats.
--   * No DROP / no column renames / no type narrowing (additive-only).
--   * New CHECK constraints are attached to NEW columns only (existing rows can
--     never violate them); the pre-existing free-text fre_limit_overrides.reason
--     column is left untouched.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Beneficiaries (work order 1) — next-of-kin designations per investor.
--    Not a money path (no idempotency key); inputs are hard-validated in the
--    service AND at the DB layer. Share-cap (sum <= 100) and max-10 rules are
--    enforced by a guarded INSERT in the repository (race-safe single statement).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_beneficiaries (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL,
    name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
    relationship text NOT NULL CHECK (char_length(btrim(relationship)) BETWEEN 2 AND 40),
    share_pct    int  NOT NULL CHECK (share_pct BETWEEN 1 AND 100),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_beneficiaries_user_idx ON fre_beneficiaries (user_id);

-- RLS: the Go backend reaches this table over the service pool; PostgREST
-- exposure is locked to the row owner (mirrors the platform's hardened-module
-- pattern — sibling fre_ tables are backend-only and predate this policy set).
ALTER TABLE fre_beneficiaries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'fre_beneficiaries' AND policyname = 'fre_beneficiaries_service_all') THEN
    CREATE POLICY fre_beneficiaries_service_all ON fre_beneficiaries
      TO service_role USING (TRUE) WITH CHECK (TRUE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'fre_beneficiaries' AND policyname = 'fre_beneficiaries_own_select') THEN
    CREATE POLICY fre_beneficiaries_own_select ON fre_beneficiaries
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'fre_beneficiaries' AND policyname = 'fre_beneficiaries_own_insert') THEN
    CREATE POLICY fre_beneficiaries_own_insert ON fre_beneficiaries
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'fre_beneficiaries' AND policyname = 'fre_beneficiaries_own_delete') THEN
    CREATE POLICY fre_beneficiaries_own_delete ON fre_beneficiaries
      FOR DELETE TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Secondary-listing idempotency (work order 3). ListFraction previously
--    ignored the client's Idempotency-Key; the column + partial unique index
--    make a duplicate list-for-sale a replay of the original listing.
--    (fre_secondary_orders already carries idempotency_key NOT NULL UNIQUE —
--    BuyFraction was verified to honour it end-to-end; no change needed there.)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE fre_secondary_listings ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS fre_listings_idem_uidx
  ON fre_secondary_listings (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Auto-invest execution state (work order 4). Plans are executed by a
--    background runner (StartAutoInvestRunner) through the EXISTING Subscribe
--    money path with a deterministic idempotency key
--    (autoinvest:{plan_id}:{scheduled_run_iso}) — crash re-runs can never
--    double-invest. Failures are fail-closed: status='failed' + last_error.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE fre_auto_invest ADD COLUMN IF NOT EXISTS last_run_at timestamptz;
ALTER TABLE fre_auto_invest ADD COLUMN IF NOT EXISTS last_error  text;
CREATE INDEX IF NOT EXISTS fre_auto_invest_due_idx ON fre_auto_invest (status, next_run_at);

-- Backfill: active plans created before the runner existed have no schedule.
-- Anchor their first run to creation time + one cadence period (idempotent,
-- additive data fix; a due-in-the-past plan simply runs on the next tick).
UPDATE fre_auto_invest
SET next_run_at = created_at + CASE WHEN cadence = 'weekly' THEN interval '7 days' ELSE interval '1 month' END
WHERE next_run_at IS NULL AND status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Limit-override reason codes (work order 7). The existing `reason` column
--    is free text and pre-existing rows may hold arbitrary values, so the CHECK
--    goes on a NEW typed column (additive; existing rows get 'other').
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE fre_limit_overrides ADD COLUMN IF NOT EXISTS reason_code text NOT NULL DEFAULT 'other'
  CHECK (reason_code IN ('hni_upgrade','vip_waiver','error_correction','compliance_review','other'));
