-- ADR-PR879: closing a telemedicine appointment is claim-then-pay.
--
-- One conditional UPDATE claims the terminal state (completed | cancelled), so
-- complete and cancel can never both win. The money (settle | refund) follows
-- through the idempotent settlement service. closed_at marks a claim made that
-- way, so the reconciler finishes only claims whose payment did not land (crash,
-- timeout). It never touches appointments closed before this existed.
--
-- review_required_at / review_reason queue a consult for an admin decision: one
-- stuck in_progress past the timeout, or one the patient reported. The admin
-- then settles or refunds it through the same audited claim-then-pay path.
-- Additive only; idempotent.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS closed_at          TIMESTAMPTZ;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS review_required_at TIMESTAMPTZ;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS review_reason      TEXT;

CREATE INDEX IF NOT EXISTS appointments_closed_unpaid_idx
    ON public.appointments (closed_at) WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_review_queue_idx
    ON public.appointments (review_required_at) WHERE review_required_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_in_progress_idx
    ON public.appointments (scheduled_at) WHERE status = 'in_progress';
