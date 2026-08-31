-- Paymax Marketplace — Followed sellers (§ Mobile-UX-Flows.md LD-005).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX guarded IF NOT EXISTS. Safe to re-run.
--
-- The mobile Account > Following screen (and account.api.ts's
-- listFollowedSellers/followSeller/unfollowSeller) has always called
-- /api/v1/marketplace/followed-sellers, but no backing table or Go route ever
-- existed for it — the only implementation was an in-memory mock fixture, so
-- with EXPO_PUBLIC_MARKETPLACE_USE_MOCK=false the live call 404'd. This is
-- the missing table.
--
-- RLS DISABLED, matching 20260908000000_marketplace_account_gaps.sql's
-- documented posture for this same "Trust & Account" table family: accessed
-- exclusively through the Go backend's service-role pgx pool, which enforces
-- owner-level authorization in the service layer — no PostgREST/anon-key path
-- reaches these rows.

BEGIN;

CREATE TABLE IF NOT EXISTS mkt_seller_follows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL,                                   -- cross-module ref, no FK
  seller_id   UUID NOT NULL,                                   -- cross-module ref, no FK
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_id, seller_id),
  CHECK (follower_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS idx_seller_follows_follower ON mkt_seller_follows(follower_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_follows_seller ON mkt_seller_follows(seller_id);

COMMIT;
