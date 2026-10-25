-- ESTD-D027 (S1) — maker-checker / approval thresholds for high-risk estate
-- admin actions (UAT EST-UAT-0421 approval-threshold changes, EST-UAT-0428
-- administrator maker-checker).
--
-- Additive only: two NEW backend-only tables, no change to existing tables.
-- Gated at runtime by FEATURE_ESTATE_DUAL_CONTROL_ENABLED (default OFF —
-- with the flag off nothing reads or writes these tables).
--
--   estate_admin_approvals       one row per high-risk admin action request.
--                                maker = initiated_by, checker = decided_by.
--   estate_approval_thresholds   per-estate threshold policy, VERSIONED and
--                                APPEND-ONLY (a change is a new row, never an
--                                UPDATE), each version pointing at the approval
--                                request that activated it.
--
-- Self-approval is refused twice: in the Go service (makercheck.Authorize) and
-- here by CHECK (decided_by <> initiated_by) — same defence-in-depth as
-- ADR-005 (admin_adjustments) and the restaurant payout approvals.

CREATE TABLE IF NOT EXISTS public.estate_admin_approvals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id         UUID NOT NULL REFERENCES public.estates(id) ON DELETE CASCADE,
    action            TEXT NOT NULL
                          CHECK (action IN ('vendor_payout','resident_ban','role_grant','threshold_change')),
    subject_id        TEXT NOT NULL,
    amount_kobo       BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
    payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
    status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','executed','expired')),
    requires_checker  BOOLEAN NOT NULL DEFAULT TRUE,
    -- Threshold snapshot at creation: a later threshold change never
    -- re-classifies an already-filed request (prior approvals preserved).
    threshold_version INT NOT NULL DEFAULT 0 CHECK (threshold_version >= 0),
    threshold_kobo    BIGINT CHECK (threshold_kobo IS NULL OR threshold_kobo >= 0),
    initiated_by      UUID NOT NULL,
    initiator_note    TEXT,
    decided_by        UUID,
    decided_at        TIMESTAMPTZ,
    decision_note     TEXT,
    executed_at       TIMESTAMPTZ,
    execution_result  JSONB,
    idempotency_key   TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    CONSTRAINT estate_admin_approvals_no_self_approve
        CHECK (decided_by IS NULL OR decided_by <> initiated_by),
    -- A dual-controlled request can only reach 'executed' through a checker.
    CONSTRAINT estate_admin_approvals_executed_has_checker
        CHECK (status <> 'executed' OR NOT requires_checker OR decided_by IS NOT NULL),
    CONSTRAINT estate_admin_approvals_idem UNIQUE (estate_id, idempotency_key)
);

-- At most one OPEN request per (estate, action, subject): two admins cannot
-- each file a payout for the same job and have both approved.
CREATE UNIQUE INDEX IF NOT EXISTS estate_admin_approvals_one_open
    ON public.estate_admin_approvals (estate_id, action, subject_id)
    WHERE status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS estate_admin_approvals_estate_status_idx
    ON public.estate_admin_approvals (estate_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.estate_approval_thresholds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id           UUID NOT NULL REFERENCES public.estates(id) ON DELETE CASCADE,
    version             INT NOT NULL CHECK (version > 0),
    -- Vendor payouts at or above this many kobo need a second approver.
    vendor_payout_kobo  BIGINT NOT NULL CHECK (vendor_payout_kobo >= 0),
    approval_request_id UUID UNIQUE REFERENCES public.estate_admin_approvals(id),
    created_by          UUID NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT estate_approval_thresholds_version UNIQUE (estate_id, version)
);

-- Append-only: history is immutable. UPDATE is always refused; a direct
-- DELETE is refused, while a cascaded delete from estates (trigger depth > 1)
-- is allowed so tearing down an estate still works.
CREATE OR REPLACE FUNCTION public.estate_approval_thresholds_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'estate_approval_thresholds is append-only (% refused)', TG_OP
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS estate_approval_thresholds_append_only ON public.estate_approval_thresholds;
CREATE TRIGGER estate_approval_thresholds_append_only
    BEFORE UPDATE OR DELETE ON public.estate_approval_thresholds
    FOR EACH ROW EXECUTE FUNCTION public.estate_approval_thresholds_append_only();

-- Backend-only tables (service role bypasses RLS): ENABLE without policies is
-- deny-all for anon/authenticated (see 20271067000020_rls_backend_only_tables.sql).
ALTER TABLE public.estate_admin_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estate_approval_thresholds ENABLE ROW LEVEL SECURITY;
