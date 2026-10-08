-- Marketplace verification requests (P0 trust-badge forgery fix).
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── mkt_verification_requests ──────────────────────────────────────────────
-- A self-serve POST /v1/marketplace/verification/{id,business} files a PENDING
-- request carrying the submitted artifact (id_type/cac_number, document_url,
-- selfie_url). The verified_*_badge columns on mkt_trust_scores are granted
-- ONLY when an admin resolves the request (via the existing
-- POST /admin/users/:id/kyc/review queue, which also clears kyc_pending).
-- Previously the endpoints set the badge synchronously on an EMPTY body — a
-- permanent trust signal forged with zero evidence. The contract
-- (MktVerificationIdRequest/MktVerificationBusinessRequest → 202 {status:pending})
-- always described this shape; the implementation now honors it.
CREATE TABLE IF NOT EXISTS public.mkt_verification_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id    TEXT NOT NULL DEFAULT 'NG',
  user_id      UUID NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('id','business')),
  -- Submitted artifact: {id_type|cac_number, document_url, selfie_url?}.
  -- Stored verbatim for reviewer display; never parsed on the money path.
  payload      JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  UUID,
  reviewed_at  TIMESTAMPTZ,
  reason_code  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most ONE open request per (user, kind): a resubmission is allowed only
-- after the previous one was decided, so a caller cannot spam the queue.
CREATE UNIQUE INDEX IF NOT EXISTS mkt_verification_requests_one_pending
  ON public.mkt_verification_requests (user_id, kind) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_mkt_verification_requests_user
  ON public.mkt_verification_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_verification_requests_status
  ON public.mkt_verification_requests (status) WHERE status = 'pending';

-- ─── RLS / grants — backend-only table, same posture as the other mkt_* ────
-- tables (mirrors 20261201000000_rls_backend_only_lockdown_wave2.sql): row
-- security enabled, direct PostgREST access revoked. All access flows through
-- the Go backend's service-role pgx pool.
ALTER TABLE public.mkt_verification_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.mkt_verification_requests FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.mkt_verification_requests FROM authenticated';
  END IF;
END $$;
