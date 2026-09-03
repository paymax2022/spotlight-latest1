-- Paymax Food — restaurant likes.
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX guarded IF NOT EXISTS. Safe to re-run.
--
-- Backs the food discovery screen's like/unlike button and per-card like
-- count. Shape mirrors 20270147000000_mkt_seller_follows.sql (the closest
-- existing "toggle + count" pattern in this codebase): a plain join table
-- keyed by the pair, no snapshot columns — the count is always a live
-- COUNT(*) at read time, never a denormalized counter that can drift.
--
-- RLS DISABLED, same posture as mkt_seller_follows and the association/
-- crowdfunding "Trust & Account" table family: accessed exclusively through
-- the Go backend's service-role pgx pool, which enforces the caller's own
-- identity in the service layer (LikeRestaurant/UnlikeRestaurant always use
-- the authenticated user_id from the request context, never a client-
-- supplied one) — no PostgREST/anon-key path reaches these rows.

BEGIN;

CREATE TABLE IF NOT EXISTS restaurant_likes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,                                              -- cross-module ref, no FK
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, restaurant_id)
);
CREATE INDEX IF NOT EXISTS idx_restaurant_likes_restaurant ON restaurant_likes(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_likes_user ON restaurant_likes(user_id, created_at DESC);

COMMIT;
