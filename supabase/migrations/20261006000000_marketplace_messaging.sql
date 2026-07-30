-- Paymax Marketplace — Messaging (ADR-023 listings-and-connect "connect" model).
--
-- A persistent 1:1 buyer↔seller conversation ABOUT a listing, carrying free-text
-- messages. This is the durable replacement for the mobile's mock-only chat. It is
-- NOT escrow/orders: no money moves, no ledger posting, no idempotency key — a thread
-- and its messages are pure metadata. Participant-level authorization is enforced in
-- the Go service layer (backend/internal/marketplace/messaging_repository.go), exactly
-- like every other mkt_* table (marketplace owns its schema; auth is done in Go, not
-- via RLS — see 20260905000000_marketplace_v1.sql which enables no RLS on mkt_*).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX guarded IF NOT EXISTS. NO DROP, NO RENAME, NO type
-- narrowing. Safe to re-run. Cross-module refs (buyer_id, seller_id) are UUIDs with NO
-- FK — they point at the core users table in another module boundary (brownfield rule).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_threads — one 1:1 conversation per (listing, buyer). The seller is the
-- listing owner (resolved at create time). buyer_last_read_at / seller_last_read_at
-- are the per-participant read cursors used to compute unread counts. last_message_at
-- is bumped on every send and drives the inbox ordering.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mkt_threads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          UUID NOT NULL REFERENCES public.mkt_listings(id),
  buyer_id            UUID NOT NULL,                 -- cross-module ref, no FK (core users table)
  seller_id           UUID NOT NULL,                 -- cross-module ref, no FK (core users table)
  buyer_last_read_at  TIMESTAMPTZ,
  seller_last_read_at TIMESTAMPTZ,
  last_message_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (listing_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS idx_mkt_threads_buyer  ON public.mkt_threads (buyer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_threads_seller ON public.mkt_threads (seller_id);
CREATE INDEX IF NOT EXISTS idx_mkt_threads_last_message
  ON public.mkt_threads (last_message_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_messages — free-text messages within a thread. Append-only in practice;
-- sender_id is the participant who wrote it.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mkt_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  UUID NOT NULL REFERENCES public.mkt_threads(id),
  sender_id  UUID NOT NULL,                          -- cross-module ref, no FK (core users table)
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_messages_thread_created
  ON public.mkt_messages (thread_id, created_at);

COMMIT;
