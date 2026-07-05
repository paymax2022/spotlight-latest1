-- Paymax Connect — Phases 2,3,4,6 (Professional / Event networking / Creator / Monetization)
-- Ref: docs/prd/dating/{acceptance.md §27, data-model.md §22, compliance.md, api.md}
--
-- Additive-only: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
-- NO existing table is modified. Phase 3 REUSES the existing public.events /
-- public.event_tickets tables (20260616240000_events.sql) — it only adds Connect
-- networking opt-in + attendee-discovery + saved-contact join tables on top.
-- Phase 6 REUSES the finance ledger/wallet (ledger_accounts/ledger_entries) — it
-- adds backend-owned plan/entitlement projection tables; balances stay derived.
--
-- Reused helpers: public.is_admin(), public.handle_updated_at(). Money = BIGINT kobo.
-- RLS on every table with service_role bypass. Audit/immutable tables: corrections
-- = new rows. Plans/prices/entitlements are backend-owned (connect_plans/config),
-- never hard-coded in the app.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — Professional networking
-- ════════════════════════════════════════════════════════════════════════════

-- Professional profile + business verification (an application/capability split:
-- the profile is the durable record; verification_status drives the lifecycle).
CREATE TABLE IF NOT EXISTS public.connect_professional_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  headline            text,
  company             text,
  role_title          text,
  industry            text,
  bio                 text,
  links               jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Business verification is a guarded state machine (deny-by-default).
  verification_status text NOT NULL DEFAULT 'unverified'
                        CHECK (verification_status IN
                          ('unverified','pending','verified','rejected')),
  -- Encrypted reference to the business-verification evidence (NEVER plaintext PII).
  verification_ref    text,
  verified_at         timestamptz,
  visible             boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_pro_profiles_status
  ON public.connect_professional_profiles (verification_status);
CREATE INDEX IF NOT EXISTS idx_connect_pro_profiles_industry
  ON public.connect_professional_profiles (industry) WHERE visible;

-- Intro requests enforce CONSENT BEFORE MESSAGING (invariant 4 / Phase 2 acceptance):
-- a pending request grants no chat; only an accepted request unlocks contact exchange.
CREATE TABLE IF NOT EXISTS public.connect_intro_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message      text,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','declined','withdrawn')),
  responded_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id),
  UNIQUE (from_user_id, to_user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_intro_to   ON public.connect_intro_requests (to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_connect_intro_from ON public.connect_intro_requests (from_user_id, status);

-- Business cards: a user's shareable card; exchanged only on accepted intro.
CREATE TABLE IF NOT EXISTS public.connect_business_cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  title       text,
  company     text,
  email       text,
  phone       text,
  links       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- Saved contacts (address book) — owner saves another user's card snapshot.
CREATE TABLE IF NOT EXISTS public.connect_saved_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Snapshot of the exchanged card at save-time (so it survives card edits).
  card_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source        text NOT NULL DEFAULT 'professional'
                  CHECK (source IN ('professional','event')),
  source_ref    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_id <> contact_id),
  UNIQUE (owner_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_saved_contacts_owner
  ON public.connect_saved_contacts (owner_id, created_at DESC);

-- Professional rooms (topic channels) + membership/moderation.
CREATE TABLE IF NOT EXISTS public.connect_rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  topic       text,
  visibility  text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','suspended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_rooms_status ON public.connect_rooms (status);

CREATE TABLE IF NOT EXISTS public.connect_room_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id   uuid NOT NULL REFERENCES public.connect_rooms(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','moderator','member')),
  status    text NOT NULL DEFAULT 'active' CHECK (status IN ('active','muted','removed')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_room_members_room ON public.connect_room_members (room_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 3 — Event networking (REUSES existing public.events / public.event_tickets)
-- ════════════════════════════════════════════════════════════════════════════

-- Explicit per-event networking opt-in with opt-in privacy controls.
CREATE TABLE IF NOT EXISTS public.connect_event_optins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opted_in    boolean NOT NULL DEFAULT true,
  -- What an opted-in attendee exposes to others (default minimal).
  visibility  jsonb NOT NULL DEFAULT '{"name":true,"headline":false,"company":false}'::jsonb,
  checked_in  boolean NOT NULL DEFAULT false,
  checked_in_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_event_optins_event
  ON public.connect_event_optins (event_id) WHERE opted_in;

-- Saved event contacts (links to existing event + the contact user).
CREATE TABLE IF NOT EXISTS public.connect_event_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_id <> contact_id),
  UNIQUE (event_id, owner_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_event_contacts_owner
  ON public.connect_event_contacts (owner_id, event_id);

-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 4 — Creator
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.connect_creator_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  handle              text UNIQUE,
  display_name        text,
  category            text,
  bio                 text,
  -- Spotlight creator verification — guarded state machine.
  verification_status text NOT NULL DEFAULT 'unverified'
                        CHECK (verification_status IN
                          ('unverified','pending','verified','rejected')),
  verification_ref    text,
  verified_at         timestamptz,
  -- Fan-message control: who may DM the creator (server-enforced).
  fan_messages        text NOT NULL DEFAULT 'verified_only'
                        CHECK (fan_messages IN ('open','verified_only','off')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_creator_status
  ON public.connect_creator_profiles (verification_status);

CREATE TABLE IF NOT EXISTS public.connect_portfolio_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  uuid NOT NULL REFERENCES public.connect_creator_profiles(id) ON DELETE CASCADE,
  title       text NOT NULL,
  url         text,
  kind        text NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video','link','audio')),
  -- Media is moderated before public visibility (invariant 9).
  moderation_status text NOT NULL DEFAULT 'pending'
                        CHECK (moderation_status IN ('pending','approved','rejected')),
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_portfolio_creator
  ON public.connect_portfolio_items (creator_id, position);

CREATE TABLE IF NOT EXISTS public.connect_collab_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_id   uuid NOT NULL REFERENCES public.connect_creator_profiles(id) ON DELETE CASCADE,
  subject      text,
  body         text,
  budget_kobo  bigint CHECK (budget_kobo IS NULL OR budget_kobo >= 0),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','declined','withdrawn')),
  responded_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_collab_creator
  ON public.connect_collab_requests (creator_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- PHASE 6 — Monetization (REUSES finance ledger/wallet for money movement)
-- ════════════════════════════════════════════════════════════════════════════

-- Backend-owned catalogue of plans/boosts/passes. Prices/entitlements live HERE,
-- never hard-coded in the app. interval_days NULL = one-off (boost/pass).
CREATE TABLE IF NOT EXISTS public.connect_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('subscription','boost','pass')),
  name          text NOT NULL,
  price_kobo    bigint NOT NULL CHECK (price_kobo >= 0),
  interval_days int CHECK (interval_days IS NULL OR interval_days > 0),
  -- Entitlements granted while active (e.g. {"super_likes_per_day":5,"see_likers":true}).
  entitlements  jsonb NOT NULL DEFAULT '{}'::jsonb,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_plans_active ON public.connect_plans (active, kind);

-- Immutable purchase/order log. One row per money mutation; idempotency_key UNIQUE
-- mirrors the ledger key so a retried purchase never double-charges. ledger_ref
-- ties the order to its posted ledger entries (audit trail).
CREATE TABLE IF NOT EXISTS public.connect_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id         uuid NOT NULL REFERENCES public.connect_plans(id),
  plan_code       text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('subscription','boost','pass')),
  amount_kobo     bigint NOT NULL CHECK (amount_kobo >= 0),
  status          text NOT NULL DEFAULT 'paid'
                    CHECK (status IN ('paid','refunded','failed')),
  idempotency_key text NOT NULL,
  ledger_ref      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_connect_orders_user ON public.connect_orders (user_id, created_at DESC);

-- Entitlement projection: server-side source of truth for what a user may do.
-- A subscription writes/extends a row; boosts/passes write short-lived grants.
-- Reads are server-side only (never trust the client).
CREATE TABLE IF NOT EXISTS public.connect_entitlements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code   text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('subscription','boost','pass')),
  features    jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,           -- NULL = until revoked
  source_order uuid REFERENCES public.connect_orders(id) ON DELETE SET NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_entitlements_active
  ON public.connect_entitlements (user_id) WHERE active;
-- At most one ACTIVE subscription per user (illegal state unreachable).
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_entitlements_active_sub
  ON public.connect_entitlements (user_id)
  WHERE active AND kind = 'subscription';

-- Bookings made from the date planner — reuse Mobility (rides) + Events (tickets).
-- This is a thin Connect-side reference; the actual ride/ticket lives in its own
-- module. ledger_ref / idempotency tie back to the wallet debit.
CREATE TABLE IF NOT EXISTS public.connect_date_plan_bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('ride','ticket')),
  -- Reference into the reused module (event_tickets.id / transport booking id).
  external_ref    text,
  event_id        uuid REFERENCES public.events(id) ON DELETE SET NULL,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo >= 0),
  status          text NOT NULL DEFAULT 'booked'
                    CHECK (status IN ('booked','cancelled','refunded')),
  idempotency_key text NOT NULL,
  ledger_ref      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_connect_date_bookings_user
  ON public.connect_date_plan_bookings (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse generic public.handle_updated_at)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'connect_professional_profiles','connect_intro_requests','connect_business_cards',
    'connect_rooms','connect_event_optins','connect_creator_profiles',
    'connect_collab_requests','connect_plans','connect_entitlements'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$s '
      'FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.connect_professional_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_intro_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_business_cards        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_saved_contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_rooms                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_room_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_event_optins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_event_contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_creator_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_portfolio_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_collab_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_plans                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_entitlements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_date_plan_bookings    ENABLE ROW LEVEL SECURITY;

-- Helper: a service_role bypass policy on each table.
-- (Created individually so each is idempotent / inspectable.)

-- professional profiles: owner manages own; visible+verified readable; admin all.
DROP POLICY IF EXISTS connect_pro_profiles_owner ON public.connect_professional_profiles;
CREATE POLICY connect_pro_profiles_owner ON public.connect_professional_profiles
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_pro_profiles_read ON public.connect_professional_profiles;
CREATE POLICY connect_pro_profiles_read ON public.connect_professional_profiles
  FOR SELECT TO authenticated USING (visible OR public.is_admin());
DROP POLICY IF EXISTS connect_pro_profiles_service ON public.connect_professional_profiles;
CREATE POLICY connect_pro_profiles_service ON public.connect_professional_profiles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- intro requests: either party reads; sender creates; recipient responds (service does updates).
DROP POLICY IF EXISTS connect_intro_party_read ON public.connect_intro_requests;
CREATE POLICY connect_intro_party_read ON public.connect_intro_requests
  FOR SELECT TO authenticated
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_intro_sender_insert ON public.connect_intro_requests;
CREATE POLICY connect_intro_sender_insert ON public.connect_intro_requests
  FOR INSERT TO authenticated WITH CHECK (from_user_id = auth.uid());
DROP POLICY IF EXISTS connect_intro_service ON public.connect_intro_requests;
CREATE POLICY connect_intro_service ON public.connect_intro_requests
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- business cards: owner manages own; service reads for exchange.
DROP POLICY IF EXISTS connect_cards_owner ON public.connect_business_cards;
CREATE POLICY connect_cards_owner ON public.connect_business_cards
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_cards_service ON public.connect_business_cards;
CREATE POLICY connect_cards_service ON public.connect_business_cards
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- saved contacts: owner only.
DROP POLICY IF EXISTS connect_saved_owner ON public.connect_saved_contacts;
CREATE POLICY connect_saved_owner ON public.connect_saved_contacts
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS connect_saved_service ON public.connect_saved_contacts;
CREATE POLICY connect_saved_service ON public.connect_saved_contacts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- rooms: public rooms readable; owner manages; admin all.
DROP POLICY IF EXISTS connect_rooms_read ON public.connect_rooms;
CREATE POLICY connect_rooms_read ON public.connect_rooms
  FOR SELECT TO authenticated
  USING (visibility = 'public' OR owner_id = auth.uid() OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_room_members m
                    WHERE m.room_id = connect_rooms.id AND m.user_id = auth.uid()
                      AND m.status = 'active'));
DROP POLICY IF EXISTS connect_rooms_owner ON public.connect_rooms;
CREATE POLICY connect_rooms_owner ON public.connect_rooms
  FOR ALL TO authenticated USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_rooms_service ON public.connect_rooms;
CREATE POLICY connect_rooms_service ON public.connect_rooms
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- room members: member sees own membership + co-members of same room; service writes moderation.
DROP POLICY IF EXISTS connect_room_members_read ON public.connect_room_members;
CREATE POLICY connect_room_members_read ON public.connect_room_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_rooms r
                    WHERE r.id = connect_room_members.room_id AND r.owner_id = auth.uid()));
DROP POLICY IF EXISTS connect_room_members_self_join ON public.connect_room_members;
CREATE POLICY connect_room_members_self_join ON public.connect_room_members
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_room_members_service ON public.connect_room_members;
CREATE POLICY connect_room_members_service ON public.connect_room_members
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- event opt-ins: owner manages own; co-opted-in attendees of same event may read
-- (attendee discovery, opt-in privacy); admin all.
DROP POLICY IF EXISTS connect_event_optin_owner ON public.connect_event_optins;
CREATE POLICY connect_event_optin_owner ON public.connect_event_optins
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_event_optin_discover ON public.connect_event_optins;
CREATE POLICY connect_event_optin_discover ON public.connect_event_optins
  FOR SELECT TO authenticated
  USING (public.is_admin() OR (opted_in AND EXISTS (
            SELECT 1 FROM public.connect_event_optins me
            WHERE me.event_id = connect_event_optins.event_id
              AND me.user_id = auth.uid() AND me.opted_in)));
DROP POLICY IF EXISTS connect_event_optin_service ON public.connect_event_optins;
CREATE POLICY connect_event_optin_service ON public.connect_event_optins
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- event contacts: owner only.
DROP POLICY IF EXISTS connect_event_contacts_owner ON public.connect_event_contacts;
CREATE POLICY connect_event_contacts_owner ON public.connect_event_contacts
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS connect_event_contacts_service ON public.connect_event_contacts;
CREATE POLICY connect_event_contacts_service ON public.connect_event_contacts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- creator profiles: owner manages; verified profiles readable; admin all.
DROP POLICY IF EXISTS connect_creator_owner ON public.connect_creator_profiles;
CREATE POLICY connect_creator_owner ON public.connect_creator_profiles
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_creator_read ON public.connect_creator_profiles;
CREATE POLICY connect_creator_read ON public.connect_creator_profiles
  FOR SELECT TO authenticated
  USING (verification_status = 'verified' OR user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_creator_service ON public.connect_creator_profiles;
CREATE POLICY connect_creator_service ON public.connect_creator_profiles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- portfolio: owner manages own; approved items publicly readable (invariant 9).
DROP POLICY IF EXISTS connect_portfolio_owner ON public.connect_portfolio_items;
CREATE POLICY connect_portfolio_owner ON public.connect_portfolio_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.connect_creator_profiles cp
                 WHERE cp.id = connect_portfolio_items.creator_id AND cp.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.connect_creator_profiles cp
                 WHERE cp.id = connect_portfolio_items.creator_id AND cp.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_portfolio_read ON public.connect_portfolio_items;
CREATE POLICY connect_portfolio_read ON public.connect_portfolio_items
  FOR SELECT TO authenticated USING (moderation_status = 'approved' OR public.is_admin());
DROP POLICY IF EXISTS connect_portfolio_service ON public.connect_portfolio_items;
CREATE POLICY connect_portfolio_service ON public.connect_portfolio_items
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- collab requests: requester + creator-owner read; requester creates; service updates.
DROP POLICY IF EXISTS connect_collab_party_read ON public.connect_collab_requests;
CREATE POLICY connect_collab_party_read ON public.connect_collab_requests
  FOR SELECT TO authenticated
  USING (from_user_id = auth.uid() OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_creator_profiles cp
                    WHERE cp.id = connect_collab_requests.creator_id AND cp.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_collab_insert ON public.connect_collab_requests;
CREATE POLICY connect_collab_insert ON public.connect_collab_requests
  FOR INSERT TO authenticated WITH CHECK (from_user_id = auth.uid());
DROP POLICY IF EXISTS connect_collab_service ON public.connect_collab_requests;
CREATE POLICY connect_collab_service ON public.connect_collab_requests
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- plans: active plans readable by anyone authed; only admin/service writes.
DROP POLICY IF EXISTS connect_plans_read ON public.connect_plans;
CREATE POLICY connect_plans_read ON public.connect_plans
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS connect_plans_admin_write ON public.connect_plans;
CREATE POLICY connect_plans_admin_write ON public.connect_plans
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS connect_plans_service ON public.connect_plans;
CREATE POLICY connect_plans_service ON public.connect_plans
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- orders: user reads own; admin reads all (reconciliation); writes service-only
-- (money path posts via service-role; immutable — no UPDATE/DELETE policies).
DROP POLICY IF EXISTS connect_orders_own ON public.connect_orders;
CREATE POLICY connect_orders_own ON public.connect_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_orders_service ON public.connect_orders;
CREATE POLICY connect_orders_service ON public.connect_orders
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- entitlements: user reads own; admin reads all; writes service-only (server-side enforcement).
DROP POLICY IF EXISTS connect_entitlements_own ON public.connect_entitlements;
CREATE POLICY connect_entitlements_own ON public.connect_entitlements
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_entitlements_service ON public.connect_entitlements;
CREATE POLICY connect_entitlements_service ON public.connect_entitlements
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- date-plan bookings: user reads own; admin reads all; writes service-only.
DROP POLICY IF EXISTS connect_date_bookings_own ON public.connect_date_plan_bookings;
CREATE POLICY connect_date_bookings_own ON public.connect_date_plan_bookings
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_date_bookings_service ON public.connect_date_plan_bookings;
CREATE POLICY connect_date_bookings_service ON public.connect_date_plan_bookings
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions for the new admin actions (additive; ON CONFLICT DO NOTHING).
-- Reuses the enterprise RBAC tables from 20260527100000_enterprise_auth_rbac.sql.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Connect Creator Verification',   'connect.creator.view',    'connect', 'creator', 'view',    'View Connect creator verification queue', true),
  ('Review Connect Creator Verification', 'connect.creator.review',  'connect', 'creator', 'review',  'Approve or reject Connect creator verification', true),
  ('View Connect Business Verification',  'connect.business.view',   'connect', 'business','view',    'View Connect professional/business verification queue', true),
  ('Review Connect Business Verification','connect.business.review', 'connect', 'business','review',  'Approve or reject Connect business verification', true),
  ('Manage Connect Plans',                'connect.plans.manage',    'connect', 'plan',    'manage',  'Create/update monetization plans, boosts and passes', true),
  ('Reconcile Connect Payments',          'connect.payments.reconcile','connect','payment','reconcile','Read orders/ledger refs and reconcile Connect payments', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant full new set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.creator.view','connect.creator.review','connect.business.view',
   'connect.business.review','connect.plans.manage','connect.payments.reconcile'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.creator.view','connect.creator.review','connect.business.view',
   'connect.business.review','connect.plans.manage','connect.payments.reconcile'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Connect-moderator gets the review/queue subset (not plan/payment management).
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.creator.view','connect.creator.review','connect.business.view','connect.business.review'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'connect-moderator'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- Seed backend-owned plan catalogue + entitlement config (idempotent).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.connect_plans (code, kind, name, price_kobo, interval_days, entitlements, active) VALUES
  ('connect_plus_monthly', 'subscription', 'Connect Plus (Monthly)', 250000, 30,
     '{"super_likes_per_day":5,"see_likers":true,"boosts_per_month":1}'::jsonb, true),
  ('connect_gold_monthly', 'subscription', 'Connect Gold (Monthly)', 500000, 30,
     '{"super_likes_per_day":10,"see_likers":true,"boosts_per_month":4,"priority_discovery":true}'::jsonb, true),
  ('boost_30min', 'boost', 'Profile Boost (30 min)', 80000, NULL,
     '{"boost_minutes":30}'::jsonb, true),
  ('pass_super5', 'pass', 'Super Like Pass (5)', 60000, NULL,
     '{"super_likes":5}'::jsonb, true)
ON CONFLICT (code) DO NOTHING;

-- Config row pointing the app at the backend-owned catalogue (mobile reads, none hard-coded).
INSERT INTO public.connect_config (key, value, scope, visibility, description) VALUES
  ('monetization.enabled', 'true'::jsonb, 'global', 'public',
     'Master switch for Connect monetization (Phase 6)'),
  ('monetization.currency', '"NGN"'::jsonb, 'global', 'public',
     'Settlement currency for Connect purchases (amounts stored as kobo)'),
  ('monetization.catalogue_source', '"connect_plans"'::jsonb, 'global', 'public',
     'Backend table the app reads plans/boosts/passes from (never hard-coded client-side)')
ON CONFLICT (key) DO NOTHING;

COMMIT;
