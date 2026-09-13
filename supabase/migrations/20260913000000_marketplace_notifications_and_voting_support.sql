-- Paymax Marketplace & Voting — Notifications Feed & Support System
-- Adds real notification feed (distinct from preferences) and voting support tickets
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX IF NOT EXISTS. NO DROP, NO RENAME,
-- NO type narrowing, NO SET NOT NULL on a populated column. Safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- mkt_notifications — marketplace notification feed (distinct from prefs).
-- Records all user notifications: new offers, price drops, order updates, etc.
-- ════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE mkt_notification_type AS ENUM (
    'new_offer',           -- buyer made an offer on your listing
    'offer_accepted',      -- seller accepted your offer
    'offer_declined',      -- seller declined your offer
    'offer_countered',     -- seller countered your offer
    'price_dropped',       -- price dropped on a saved item
    'listing_ending_soon', -- saved listing expiring in 7 days
    'low_stock',          -- saved item low on stock
    'boost_expiring',      -- your boost ending soon
    'boost_ended',         -- your boost ended
    'message_new',         -- new message in thread
    'deal_marked_met',     -- buyer marked deal as met
    'review_requested',    -- review window opening
    'support_reply'        -- response to your support ticket
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mkt_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,                    -- recipient (cross-module ref, no FK)
  market_id       TEXT NOT NULL DEFAULT 'NG',
  type            mkt_notification_type NOT NULL,
  title           TEXT NOT NULL,                    -- short notification title
  body            TEXT,                             -- optional longer description
  data            JSONB NOT NULL DEFAULT '{}',      -- contextual data (listing_id, offer_id, etc)
  related_id      UUID,                             -- FK to related entity (listing/order/thread)
  is_read         BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mkt_notifications_user ON mkt_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_notifications_unread ON mkt_notifications(user_id, is_read, created_at DESC) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_mkt_notifications_market ON mkt_notifications(market_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- voting_support_tickets — support/help ticket system for voting module
-- Tracks support requests with context (contest, issue, resolution).
-- ════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE voting_ticket_status AS ENUM (
    'open',        -- newly created, awaiting review
    'in_progress', -- support agent actively working
    'waiting',     -- waiting for user response
    'resolved',    -- issue resolved
    'closed'       -- ticket closed
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE voting_ticket_category AS ENUM (
    'account_issue',    -- account/login problems
    'voting_problem',   -- can't vote, voting not working
    'contest_question', -- question about contest/rules
    'billing_issue',    -- payment/billing related
    'bug_report',       -- found a bug
    'feature_request',  -- feature/improvement suggestion
    'other'             -- miscellaneous
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS voting_support_tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,                   -- creator (cross-module ref, no FK)
  contest_id       UUID,                            -- optional context (cross-module ref)
  category         voting_ticket_category NOT NULL DEFAULT 'other',
  status           voting_ticket_status NOT NULL DEFAULT 'open',
  subject          TEXT NOT NULL,
  description      TEXT NOT NULL,
  priority         TEXT NOT NULL DEFAULT 'normal'  -- 'low'|'normal'|'high'|'urgent'
                     CHECK (priority IN ('low','normal','high','urgent')),
  source           TEXT,                            -- 'marketplace'|'voting'|'mobile'|'web'|etc
  assigned_to      UUID,                            -- support agent id
  resolution_notes TEXT,                            -- notes when resolving
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_voting_tickets_user ON voting_support_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voting_tickets_status ON voting_support_tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voting_tickets_contest ON voting_support_tickets(contest_id) WHERE contest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voting_tickets_assigned ON voting_support_tickets(assigned_to, status) WHERE assigned_to IS NOT NULL;

-- Ticket replies / messages within a support ticket
CREATE TABLE IF NOT EXISTS voting_ticket_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES voting_support_tickets(id) ON DELETE CASCADE,
  author_id       UUID NOT NULL,                   -- user or support agent
  is_internal     BOOLEAN NOT NULL DEFAULT false, -- internal notes not shown to user
  message         TEXT NOT NULL,
  attachments     TEXT[],                         -- optional file URLs
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON voting_ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_author ON voting_ticket_messages(author_id, created_at);

COMMIT;
