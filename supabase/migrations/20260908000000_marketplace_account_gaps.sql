-- Paymax Marketplace — Trust & Account gap tables (Agent: Trust/Account)
-- Ref: docs/prd/marketplace/Mobile-UX-Flows.md §Trust & Account (28–34),
--      ADR-021-marketplace-mobile-and-gaps.md.
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX guarded IF NOT EXISTS. NO DROP, NO RENAME,
-- NO type narrowing, NO SET NOT NULL on a populated column. Safe to re-run.
-- Sequenced after 20260907000000_bus_provider_marketplace.sql.
--
-- These tables back the non-money Account endpoints the mobile app needs and the
-- core marketplace schema (20260905000000_marketplace_v1.sql) did not include:
--   • mkt_saved_items         — buyer wishlist (distinct from mkt_saved_searches)
--   • mkt_reports             — safety reports against a listing/seller/chat
--   • mkt_blocks              — user-blocks-user list
--   • mkt_notification_prefs  — per-user, per-category notification toggles
--
-- RLS NOTE: matching the existing marketplace schema (marketplace_v1.sql), these
-- tables are accessed exclusively through the Go backend's pgx SERVICE-ROLE pool,
-- which enforces owner-level authorization (OLA) in the service layer — the same
-- posture as mkt_listings / mkt_orders / mkt_saved_searches, none of which carry
-- RLS. We therefore keep RLS DISABLED here for consistency (no PostgREST/anon-key
-- path reaches these rows). If a direct-Supabase path is ever added, owner-scoped
-- RLS + a service_role bypass policy should be introduced module-wide in one pass.
--
-- Cross-module UUID refs (user_id, seller_id, listing_id target) carry NO FK to
-- the core users table (brownfield rule: marketplace owns its own schema). The
-- one same-module FK we DO keep is mkt_saved_items.listing_id → mkt_listings(id),
-- ON DELETE CASCADE, so a removed listing drops its wishlist rows.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_saved_items — buyer wishlist. saved_price_kobo snapshots the price at save
-- time so the mobile "price changed" badge can compare against the live price.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mkt_saved_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,                                  -- cross-module ref, no FK
  listing_id       UUID NOT NULL REFERENCES mkt_listings(id) ON DELETE CASCADE,
  saved_price_kobo BIGINT NOT NULL DEFAULT 0 CHECK (saved_price_kobo >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)                                     -- one save per (user, listing)
);
CREATE INDEX IF NOT EXISTS idx_saved_items_user ON mkt_saved_items(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_items_listing ON mkt_saved_items(listing_id);

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_reports — always-accessible safety valve (§31). target_type ∈
-- {listing, seller, chat}; target_id is a free UUID/text ref (no FK — a "chat"
-- target lives in another module). status starts `open` for admin triage.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mkt_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   UUID NOT NULL,                                     -- cross-module ref, no FK
  target_type   TEXT NOT NULL CHECK (target_type IN ('listing','seller','chat')),
  target_id     TEXT NOT NULL,
  reason        TEXT NOT NULL,
  evidence_url  TEXT,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','reviewing','actioned','dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON mkt_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_target ON mkt_reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON mkt_reports(reporter_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_blocks — directed user block (§32). A self-block is rejected in the service
-- layer; the UNIQUE prevents duplicate block rows.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mkt_blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,                                   -- blocker (cross-module ref, no FK)
  blocked_user_id UUID NOT NULL,                                   -- blockee (cross-module ref, no FK)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, blocked_user_id),
  CHECK (user_id <> blocked_user_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_user ON mkt_blocks(user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_notification_prefs — one row per user, per-category toggles (§33). Defaults:
-- all on except promotional (opt-in). Absence of a row = these same defaults
-- (the backend returns them without writing).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mkt_notification_prefs (
  user_id       UUID PRIMARY KEY,                                  -- cross-module ref, no FK
  new_offer     BOOLEAN NOT NULL DEFAULT true,
  price_drop    BOOLEAN NOT NULL DEFAULT true,
  order_status  BOOLEAN NOT NULL DEFAULT true,
  boost_expiry  BOOLEAN NOT NULL DEFAULT true,
  promotional   BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
