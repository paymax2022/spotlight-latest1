-- Paymax Marketplace — Deal reviews behind a "mark met" signal (ADR-023).
--
-- ADR-023 retired escrow orders, so the old order-keyed mkt_reviews (gated on a
-- released escrow order) is dead: it has no completion signal any more. This
-- introduces THREAD-KEYED reviews instead. A "deal" == a messaging thread
-- (mkt_threads). A thread participant marks the deal "met" (they physically met /
-- transacted off-platform), after which EITHER participant may leave the OTHER a
-- single review.
--
-- Reviews are pure metadata: NO money moves, NO ledger posting, NO idempotency
-- key. Participant-level authorization is enforced in the Go service/repository
-- layer (backend/internal/marketplace), exactly like every other mkt_* table —
-- marketplace owns its schema and does auth in Go, not via RLS (see
-- 20260905000000_marketplace_v1.sql which enables no RLS on mkt_*).
--
-- ADDITIVE-ONLY: ADD COLUMN / CREATE TABLE / CREATE INDEX all guarded IF NOT
-- EXISTS. NO DROP, NO RENAME, NO type narrowing. Safe to re-run. Cross-module
-- refs (reviewer_id, reviewee_id, met_by) are UUIDs with NO FK — they point at
-- the core users table in another module boundary (brownfield rule).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_threads — the "mark met" signal. met_at is stamped once (first mark wins,
-- COALESCE-guarded in Go), met_by records which participant marked it. A thread
-- with met_at IS NOT NULL is review-eligible.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.mkt_threads ADD COLUMN IF NOT EXISTS met_at TIMESTAMPTZ;
ALTER TABLE public.mkt_threads ADD COLUMN IF NOT EXISTS met_by UUID; -- cross-module ref, no FK

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_deal_reviews — thread-keyed reviews. One review per (thread, reviewer):
-- the UNIQUE(thread_id, reviewer_id) constraint lets each of the two participants
-- review the other exactly once. reviewee_id is the counterparty. rating/comment
-- are nullable (a review may be a bare placeholder). Indexed on reviewee_id so a
-- seller-profile aggregate can read a user's inbound reviews later.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mkt_deal_reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        UUID NOT NULL REFERENCES public.mkt_threads(id),
  reviewer_id      UUID NOT NULL,                  -- cross-module ref, no FK (core users table)
  reviewee_id      UUID NOT NULL,                  -- cross-module ref, no FK (core users table)
  rating           SMALLINT CHECK (rating BETWEEN 1 AND 5), -- nullable if never rated (placeholder)
  comment          TEXT,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  seller_reply     TEXT,
  is_placeholder   BOOLEAN NOT NULL DEFAULT false,
  moderation_state TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_state IN ('visible','under_review')),
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (thread_id, reviewer_id)                  -- one review per participant per deal
);
CREATE INDEX IF NOT EXISTS idx_mkt_deal_reviews_reviewee
  ON public.mkt_deal_reviews (reviewee_id);

COMMIT;
