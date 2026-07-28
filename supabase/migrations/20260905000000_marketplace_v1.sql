-- Paymax Marketplace — Schema v1 (Agent C, Marketplace Swarm)
-- Ref: docs/prd/marketplace/SWARM_INTEGRATION_CONTRACT.md,
--      docs/prd/marketplace/Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md §1/§2.
--
-- ADDITIVE-ONLY: CREATE TYPE/TABLE/INDEX guarded to be idempotent (DO $$ blocks
-- for enums, IF NOT EXISTS for tables/indexes). NO DROP TABLE/COLUMN/TYPE, NO
-- RENAME, NO type narrowing, NO SET NOT NULL on a populated column. Safe to
-- re-run.
--
-- Money: every amount is BIGINT kobo. This module NEVER stores a wallet
-- balance — escrow moves are postings against the existing double-entry
-- ledger (backend/internal/finance/ledger), referenced here only by opaque
-- TEXT refs (ledger_fund_ref / ledger_release_ref / ledger_charge_ref /
-- refund_ref). market_id TEXT NOT NULL DEFAULT 'NG' on every first-class
-- table for SaaS multi-market readiness (per house doctrine).
--
-- Requires: pgcrypto (gen_random_uuid) and postgis (GEOGRAPHY(POINT,4326) for
-- mkt_listings.geo — near-me search on our own GiST index, matching the
-- house MapService pattern from 20260626000000_enable_postgis.sql).
--
-- Cross-module references (seller_id, buyer_id, user_id, admin_id, etc.) are
-- UUIDs with NO FK constraint — they point at the core users table which
-- lives in a different module/schema boundary (brownfield rule: marketplace
-- owns its own schema, no cross-module table writes/FKs).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ════════════════════════════════════════════════════════════════════════════
-- ENUMS — mirror the Go enums in backend/internal/marketplace exactly
-- (ListingStatus, OrderStatus, DisputeStatus, BoostStatus, KYCTier).
-- Postgres has no `CREATE TYPE IF NOT EXISTS`; guard via DO $$ + catalog check
-- so this migration is safe to re-run (matches house convention elsewhere).
-- ════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM (
    'draft','pending_review','active','paused','expired','sold',
    'removed_policy','removed_user'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'initiated','funded','seller_accepted','in_delivery','delivered',
    'inspection_window','released','cancelled','disputed','refunded','split_settled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dispute_status AS ENUM (
    'opened','evidence_window','under_review','decided','executed','closed','appealed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE boost_status AS ENUM (
    'purchased','active','completed','rejected_with_reason','auto_refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE kyc_tier AS ENUM (
    'tier0_browse','tier1_buy','tier2_sell','tier3_business'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_categories — category tree; attribute_schema drives Smart Composer forms
-- (config/schema-driven feature, not branching code).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mkt_categories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id        TEXT NOT NULL DEFAULT 'NG',
  parent_id        UUID REFERENCES mkt_categories(id),
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  attribute_schema JSONB NOT NULL DEFAULT '{}',   -- draft-07 JSON-schema for category-specific attrs
  risk_tier        SMALLINT NOT NULL DEFAULT 0,   -- 0=low,1=medium,2=high (routes to human review)
  commission_bps   INTEGER NOT NULL DEFAULT 200,  -- basis points, override per category
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_categories_market_parent ON mkt_categories(market_id, parent_id);

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_listings — the core sellable unit. description_word_count is a STORED
-- generated column enforcing the >=8-word Smart Composer gate (§2.1) at the
-- schema level, not only in application code.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mkt_listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       TEXT NOT NULL DEFAULT 'NG',
  seller_id       UUID NOT NULL,                  -- cross-module ref, no FK (core users table)
  category_id     UUID NOT NULL REFERENCES mkt_categories(id),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 10 AND 100),
  description     TEXT NOT NULL,
  description_word_count INTEGER GENERATED ALWAYS AS
    (array_length(regexp_split_to_array(trim(description), '\s+'), 1)) STORED,
  price_kobo      BIGINT NOT NULL CHECK (price_kobo >= 0),
  currency        TEXT NOT NULL DEFAULT 'NGN',
  condition       TEXT NOT NULL DEFAULT 'used',   -- 'new'|'used'|'foreign_used'|'local_used'|'refurbished'
  attrs           JSONB NOT NULL DEFAULT '{}',     -- validated against category.attribute_schema at write time
  status          listing_status NOT NULL DEFAULT 'draft',
  quality_score   NUMERIC(5,4) NOT NULL DEFAULT 0.5,
  escrow_eligible BOOLEAN NOT NULL DEFAULT true,
  geo             GEOGRAPHY(POINT, 4326),
  state           TEXT NOT NULL,
  lga             TEXT,
  view_count      BIGINT NOT NULL DEFAULT 0,       -- synced from Redis HLL every 60s
  save_count      BIGINT NOT NULL DEFAULT 0,
  moderation_reason_code TEXT,                     -- set on removed_policy; never null when rejected
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 days'),
  sold_at         TIMESTAMPTZ,
  CONSTRAINT chk_listings_min_words CHECK (description_word_count >= 8)
);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON mkt_listings(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_market_category ON mkt_listings(market_id, category_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_geo ON mkt_listings USING GIST(geo);
CREATE INDEX IF NOT EXISTS idx_listings_expires ON mkt_listings(expires_at) WHERE status = 'active';

-- Outbox table — CDC source for the Elasticsearch indexer worker (Agent B
-- drains this; Agent A writes to it on any listing state change affecting
-- search). op IN ('upsert','delete').
CREATE TABLE IF NOT EXISTS mkt_listings_outbox (
  id              BIGSERIAL PRIMARY KEY,
  listing_id      UUID NOT NULL REFERENCES mkt_listings(id),
  op              TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload         JSONB NOT NULL,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON mkt_listings_outbox(created_at) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS mkt_listing_media (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES mkt_listings(id) ON DELETE CASCADE,
  url_thumb       TEXT NOT NULL,
  url_card        TEXT NOT NULL,
  url_full        TEXT NOT NULL,
  blurhash        TEXT NOT NULL,
  perceptual_hash TEXT NOT NULL,                   -- for duplicate/stolen-photo detection
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_phash ON mkt_listing_media(perceptual_hash);
CREATE INDEX IF NOT EXISTS idx_media_listing ON mkt_listing_media(listing_id, sort_order);

CREATE TABLE IF NOT EXISTS mkt_offers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id        TEXT NOT NULL DEFAULT 'NG',
  listing_id       UUID NOT NULL REFERENCES mkt_listings(id),
  buyer_id         UUID NOT NULL,
  offer_price_kobo BIGINT NOT NULL CHECK (offer_price_kobo > 0),
  status           TEXT NOT NULL DEFAULT 'pending' -- 'pending'|'accepted'|'declined'|'countered'|'expired'
                     CHECK (status IN ('pending','accepted','declined','countered','expired')),
  parent_offer_id  UUID REFERENCES mkt_offers(id), -- counter-offer chains
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours')
);
CREATE INDEX IF NOT EXISTS idx_offers_listing ON mkt_offers(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_buyer ON mkt_offers(buyer_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_orders — the escrow FSM (§2.2). idempotency_key UNIQUE gives the
-- create-order path natural idempotency; ledger_fund_ref/ledger_release_ref
-- are opaque refs into the core ledger (NEVER a balance column here).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mkt_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id             TEXT NOT NULL DEFAULT 'NG',
  listing_id            UUID NOT NULL REFERENCES mkt_listings(id),
  buyer_id              UUID NOT NULL,
  seller_id             UUID NOT NULL,
  offer_id              UUID REFERENCES mkt_offers(id),
  amount_kobo           BIGINT NOT NULL CHECK (amount_kobo > 0),
  escrow_fee_kobo       BIGINT NOT NULL CHECK (escrow_fee_kobo >= 0),
  delivery_fee_kobo     BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_kobo >= 0),
  status                order_status NOT NULL DEFAULT 'initiated',
  ledger_fund_ref       TEXT,                       -- ref into core wallet ledger (funding tx)
  ledger_release_ref    TEXT,                       -- ref into core wallet ledger (release tx)
  delivery_ref          TEXT,                       -- ref into logistics module
  pod_photo_url         TEXT,
  pod_otp_confirmed_at  TIMESTAMPTZ,
  inspection_deadline   TIMESTAMPTZ,                -- delivered_at + 48h
  idempotency_key       TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  funded_at             TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  released_at           TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON mkt_orders(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON mkt_orders(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_inspection_deadline ON mkt_orders(inspection_deadline) WHERE status = 'inspection_window';
CREATE INDEX IF NOT EXISTS idx_orders_market_status ON mkt_orders(market_id, status);
-- Admin "orders/aging" dashboard: surfaces long-stuck non-terminal orders.
CREATE INDEX IF NOT EXISTS idx_orders_aging ON mkt_orders(created_at)
  WHERE status IN ('initiated','funded','seller_accepted','in_delivery','delivered','inspection_window','disputed');

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_disputes — dual-approval when order.amount_kobo > ₦500,000 (50000000 kobo).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS mkt_disputes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id              TEXT NOT NULL DEFAULT 'NG',
  order_id               UUID NOT NULL REFERENCES mkt_orders(id),
  opened_by              UUID NOT NULL,             -- buyer_id or seller_id
  reason_code            TEXT NOT NULL,
  status                 dispute_status NOT NULL DEFAULT 'opened',
  decision               TEXT CHECK (decision IN ('refund_buyer','release_seller','split')),
  decision_notes         TEXT,
  decided_by             UUID,                       -- admin user id
  requires_dual_approval BOOLEAN NOT NULL DEFAULT false, -- true when order.amount_kobo > 50000000 (₦500k)
  second_approver_id     UUID,
  evidence_deadline      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at             TIMESTAMPTZ,
  executed_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_disputes_order ON mkt_disputes(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_aging ON mkt_disputes(created_at) WHERE status NOT IN ('closed','executed');
CREATE INDEX IF NOT EXISTS idx_disputes_market_status ON mkt_disputes(market_id, status);

CREATE TABLE IF NOT EXISTS mkt_dispute_evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id      UUID NOT NULL REFERENCES mkt_disputes(id) ON DELETE CASCADE,
  submitted_by    UUID NOT NULL,
  evidence_type   TEXT NOT NULL CHECK (evidence_type IN ('photo','chat_excerpt','document')),
  url_or_text     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute ON mkt_dispute_evidence(dispute_id);

-- REVIEW INTEGRITY: this table's existence is enforced by application logic,
-- not just schema — any order reaching 'released' MUST have a row inserted
-- here (system-generated placeholder if the buyer never submits one) so the
-- count is never silently absent from a seller's profile.
CREATE TABLE IF NOT EXISTS mkt_reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id        TEXT NOT NULL DEFAULT 'NG',
  order_id         UUID NOT NULL UNIQUE REFERENCES mkt_orders(id), -- UNIQUE enforces transaction-gating
  reviewer_id      UUID NOT NULL,
  reviewee_id      UUID NOT NULL,
  rating           SMALLINT CHECK (rating BETWEEN 1 AND 5), -- nullable if buyer never rates (system placeholder)
  comment          TEXT,
  seller_reply     TEXT,
  is_placeholder   BOOLEAN NOT NULL DEFAULT false, -- true if system-generated because buyer didn't review
  moderation_state TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_state IN ('visible','under_review')), -- NEVER 'hidden'/'deleted'
  moderation_reason_code TEXT,
  moderated_by     UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON mkt_reviews(reviewee_id, moderation_state);

CREATE TABLE IF NOT EXISTS mkt_boosts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id         TEXT NOT NULL DEFAULT 'NG',
  listing_id        UUID NOT NULL REFERENCES mkt_listings(id),
  seller_id         UUID NOT NULL,
  tier              TEXT NOT NULL,                  -- 'start'|'vip'|'vip_gold'|'diamond'|'enterprise'
  duration_days     INTEGER NOT NULL CHECK (duration_days > 0),
  price_kobo        BIGINT NOT NULL CHECK (price_kobo >= 0),
  ledger_charge_ref TEXT NOT NULL,                  -- wallet-native spend, no separate ad balance
  status            boost_status NOT NULL DEFAULT 'purchased',
  rejection_reason_code TEXT,
  refund_ref        TEXT,
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boosts_active ON mkt_boosts(listing_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_boosts_seller ON mkt_boosts(seller_id, status);

CREATE TABLE IF NOT EXISTS mkt_saved_searches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  market_id        TEXT NOT NULL DEFAULT 'NG',
  query            TEXT,
  filters          JSONB NOT NULL DEFAULT '{}',
  alert_enabled    BOOLEAN NOT NULL DEFAULT true,
  last_notified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON mkt_saved_searches(user_id);

CREATE TABLE IF NOT EXISTS mkt_trust_scores (
  user_id                  UUID PRIMARY KEY,
  market_id                TEXT NOT NULL DEFAULT 'NG',
  kyc_tier                 kyc_tier NOT NULL DEFAULT 'tier0_browse',
  verified_id_badge        BOOLEAN NOT NULL DEFAULT false, -- PERMANENT once true; never toggled by payment status
  verified_business_badge  BOOLEAN NOT NULL DEFAULT false,
  completed_escrow_count   INTEGER NOT NULL DEFAULT 0,
  dispute_count            INTEGER NOT NULL DEFAULT 0,
  avg_response_minutes     INTEGER,
  account_created_at       TIMESTAMPTZ NOT NULL,
  trust_score              NUMERIC(5,4) NOT NULL DEFAULT 0.5, -- recomputed nightly, explainable via breakdown view
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trust_scores_market ON mkt_trust_scores(market_id);

CREATE TABLE IF NOT EXISTS mkt_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id       TEXT NOT NULL DEFAULT 'NG',
  target_type     TEXT NOT NULL CHECK (target_type IN ('listing','user','review','chat_message')),
  target_id       UUID NOT NULL,
  reporter_id     UUID NOT NULL,
  reason_code     TEXT NOT NULL,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  reviewed_by     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_flags_open ON mkt_flags(status, created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_flags_market ON mkt_flags(market_id, status);

CREATE TABLE IF NOT EXISTS mkt_price_bands (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id         TEXT NOT NULL DEFAULT 'NG',
  category_id       UUID NOT NULL REFERENCES mkt_categories(id),
  attrs_fingerprint TEXT NOT NULL,                  -- hash of the attribute combination this band covers
  p25_kobo          BIGINT NOT NULL,
  p50_kobo          BIGINT NOT NULL,
  p75_kobo          BIGINT NOT NULL,
  sample_size       INTEGER NOT NULL,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_id, category_id, attrs_fingerprint)
);

-- Admin audit log — append-only, never updated or deleted. Every mutating
-- admin route writes here automatically via middleware (never optionally).
CREATE TABLE IF NOT EXISTS mkt_admin_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  market_id       TEXT NOT NULL DEFAULT 'NG',
  admin_id        UUID NOT NULL,
  admin_role      TEXT NOT NULL,
  action          TEXT NOT NULL,
  target_type     TEXT NOT NULL,
  target_id       UUID NOT NULL,
  reason_code     TEXT NOT NULL,                    -- mandatory on every state-changing action
  before_state    JSONB,
  after_state     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON mkt_admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON mkt_admin_audit_log(admin_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_market ON mkt_admin_audit_log(market_id, created_at);

COMMIT;
