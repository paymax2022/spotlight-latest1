-- Crowdfunding — engagement domain (additive-only).
-- Support tickets, help center, in-app notifications and notification settings.
-- IRON RULES: no DROP, no RENAME, no type narrowing. Owner-scoped RLS + service_role bypass.

-- ─── support tickets ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_support_tickets (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id),
    reference  TEXT NOT NULL UNIQUE,
    subject    TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'OTHER',
    status     TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','PENDING','RESOLVED','CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_support_tickets_user_idx ON cf_support_tickets(user_id);

-- ─── ticket messages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_ticket_messages (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  UUID NOT NULL REFERENCES cf_support_tickets(id) ON DELETE CASCADE,
    from_role  TEXT NOT NULL CHECK (from_role IN ('user','support')),
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_ticket_messages_ticket_idx ON cf_ticket_messages(ticket_id);

-- ─── in-app notifications ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id),
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    read        BOOLEAN NOT NULL DEFAULT FALSE,
    campaign_id UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_notifications_user_idx ON cf_notifications(user_id);

-- ─── help center articles ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_help_articles (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic      TEXT NOT NULL,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO cf_help_articles (topic, question, answer, sort_order) VALUES
    ('contributing', 'How do I contribute to a campaign?',
     'Open the campaign, tap Contribute, choose an amount and a payment method (wallet, card, bank transfer or USSD), then confirm. You will receive a receipt and an in-app notification once the contribution is confirmed.', 1),
    ('payments', 'What payment methods are supported?',
     'You can pay from your Spotlight wallet balance, or with a debit card, bank transfer or USSD. Card and bank payments are processed securely by Paystack; wallet contributions are instant.', 2),
    ('payments', 'Are there any fees on contributions?',
     'A small platform fee and the payment processor fee apply and are shown transparently in the fee breakdown before you confirm. The amount that reaches the campaign is always displayed separately.', 3),
    ('creating', 'How do I create a campaign?',
     'Tap Create, pick a category and type, then complete the guided steps: story, goal, cover image, budget and disbursement model. Submit for review and our team verifies it before it goes live.', 4),
    ('withdrawals', 'How do withdrawals work?',
     'Campaign creators request a withdrawal to a verified bank account from the campaign wallet. Requests start as PENDING and are reviewed before payout. Funds in escrow are released per your disbursement model.', 5),
    ('trust', 'How does Spotlight keep campaigns trustworthy?',
     'Campaigns go through review and risk scoring, sensitive categories require enhanced verification, and you can report a suspicious campaign from its page. Verified creators and beneficiaries are clearly badged.', 6)
ON CONFLICT DO NOTHING;

-- ─── notification preferences ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_notification_prefs (
    user_id            UUID PRIMARY KEY REFERENCES auth.users(id),
    push               BOOLEAN NOT NULL DEFAULT TRUE,
    email              BOOLEAN NOT NULL DEFAULT TRUE,
    sms                BOOLEAN NOT NULL DEFAULT FALSE,
    contribution_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    campaign_updates   BOOLEAN NOT NULL DEFAULT TRUE,
    marketing          BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE cf_support_tickets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_ticket_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_help_articles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_notification_prefs ENABLE ROW LEVEL SECURITY;

-- Support tickets — owner-scoped.
DROP POLICY IF EXISTS "cf_support_tickets_owner" ON cf_support_tickets;
CREATE POLICY "cf_support_tickets_owner" ON cf_support_tickets
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_support_tickets_service" ON cf_support_tickets;
CREATE POLICY "cf_support_tickets_service" ON cf_support_tickets
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Ticket messages — owner-scoped via the parent ticket.
DROP POLICY IF EXISTS "cf_ticket_messages_owner" ON cf_ticket_messages;
CREATE POLICY "cf_ticket_messages_owner" ON cf_ticket_messages
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM cf_support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM cf_support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()));
DROP POLICY IF EXISTS "cf_ticket_messages_service" ON cf_ticket_messages;
CREATE POLICY "cf_ticket_messages_service" ON cf_ticket_messages
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Notifications — owner-scoped.
DROP POLICY IF EXISTS "cf_notifications_owner" ON cf_notifications;
CREATE POLICY "cf_notifications_owner" ON cf_notifications
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_notifications_service" ON cf_notifications;
CREATE POLICY "cf_notifications_service" ON cf_notifications
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Help articles — public read for authenticated users.
DROP POLICY IF EXISTS "cf_help_articles_select" ON cf_help_articles;
CREATE POLICY "cf_help_articles_select" ON cf_help_articles
    FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "cf_help_articles_service" ON cf_help_articles;
CREATE POLICY "cf_help_articles_service" ON cf_help_articles
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Notification prefs — owner-scoped.
DROP POLICY IF EXISTS "cf_notification_prefs_owner" ON cf_notification_prefs;
CREATE POLICY "cf_notification_prefs_owner" ON cf_notification_prefs
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_notification_prefs_service" ON cf_notification_prefs;
CREATE POLICY "cf_notification_prefs_service" ON cf_notification_prefs
    TO service_role USING (TRUE) WITH CHECK (TRUE);
