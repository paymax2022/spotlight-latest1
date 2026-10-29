-- Events commerce + governance (UAT workplan: events_ticketing_UAT_workplan_test_cases).
--
-- Adds the buyer-protection and platform-governance layer the ticketing core was
-- missing: purchase disclosure (city/venue address/refund policy/check-in windows),
-- order + ticket snapshots for receipts and attendee lists, a refund state machine,
-- a moderation decision trail, server-authoritative platform fees, organiser
-- sanctions, gate check-in attribution, support cases and customer notifications.
--
-- SAFETY: additive-only. CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP POLICY IF EXISTS before CREATE POLICY, ON CONFLICT DO NOTHING on every
-- seed. No DROP of a column, no rename, no type narrowing, no DELETE/UPDATE of
-- business rows except the two documented backfills below.
--
-- Deliberately does NOT touch public.events' `events_state_check` constraint
-- (20271032000000_events_organiser_lifecycle.sql owns it). A rejected or
-- changes-requested event returns to DRAFT — where the organiser can revise and
-- resubmit — and the review outcome lives in events.moderation_status plus the
-- decision trail. That keeps one lifecycle CHECK and needs no constraint rewrite.
--
-- DEPLOY GATE: apply this migration before turning FEATURE_EVENTS_COMMERCIAL on.
-- With the flag off every query stays on the pre-existing column set.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. events — disclosure, refund policy and check-in windows.
--    All defaulted, so existing rows satisfy them without backfill.
--    Ranges are enforced in the service (single source of truth); no CHECK here
--    so a future ops-tunable window never needs a migration.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS city                 text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_address        text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS refund_policy        text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS refund_cutoff_hours  int  NOT NULL DEFAULT 24;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS checkin_opens_minutes  int NOT NULL DEFAULT 360;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS checkin_closes_minutes int NOT NULL DEFAULT 120;

-- Moderation workflow: when it was submitted, the last decision, and who made it.
-- moderation_status is the review outcome; events.state stays the lifecycle enum.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS submitted_at            timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS moderation_status       text NOT NULL DEFAULT 'NONE';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS moderation_note         text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS moderation_decided_by   uuid REFERENCES auth.users(id);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS moderation_decided_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_events_city_state_starts
  ON public.events (city, state, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_moderation_status
  ON public.events (moderation_status, submitted_at)
  WHERE moderation_status <> 'NONE';

-- Moderation is platform-owned, so a client must not be able to approve its own
-- event. Same reasoning and same shape as events_protect_like_count (20271094000000):
-- `authenticated` holds TABLE-level privileges on events, so a column-level REVOKE
-- would be a silent no-op and narrowing the table grant would break existing
-- PostgREST writers. A BEFORE trigger keyed on the client roles is what actually
-- bites; the Go backend connects as the pool owner and is unaffected.
CREATE OR REPLACE FUNCTION public.events_protect_moderation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.submitted_at          := NULL;
      NEW.moderation_status     := 'NONE';
      NEW.moderation_note       := '';
      NEW.moderation_decided_by := NULL;
      NEW.moderation_decided_at := NULL;
    ELSE
      NEW.submitted_at          := OLD.submitted_at;
      NEW.moderation_status     := OLD.moderation_status;
      NEW.moderation_note       := OLD.moderation_note;
      NEW.moderation_decided_by := OLD.moderation_decided_by;
      NEW.moderation_decided_at := OLD.moderation_decided_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_events_protect_moderation
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_protect_moderation();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. event_orders — what the buyer was actually sold.
--
-- A receipt has to restate the price it showed at checkout. Reading tiers.price
-- back at receipt time would silently re-price a purchase after the organiser
-- edits a tier, so the agreed numbers are snapshotted on the order row.
--
-- booking_ref groups the per-seat orders of ONE checkout. PurchaseTickets keys
-- seat i of an n-seat batch as "<base>:<i>" (single-unit keeps "<base>" verbatim
-- — service.go unitIdemKey), so stripping the trailing ":i" recovers the booking
-- the seats belong to without touching the money path's idempotency at all.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS attendee_name   text   NOT NULL DEFAULT '';
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS booking_ref     text   NOT NULL DEFAULT '';
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS tier_name       text   NOT NULL DEFAULT '';
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS promo_code      text   NOT NULL DEFAULT '';
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS unit_price_kobo bigint NOT NULL DEFAULT 0;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS discount_kobo   bigint NOT NULL DEFAULT 0;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS refunded_kobo   bigint NOT NULL DEFAULT 0;

-- Backfill (history only, never a money rewrite):
--   booking_ref from the derived idempotency key.
--   unit_price/discount for pre-migration rows are unknowable individually — a
--   promo's rate is versioned and its history is not per-order — so each legacy
--   order is reconstructed as one undiscounted seat at the amount actually
--   collected. Honest to the ledger total; not a claim that no promo existed.
UPDATE public.event_orders
   SET booking_ref = regexp_replace(idempotency_key, ':[0-9]+$', '')
 WHERE booking_ref = '' AND idempotency_key IS NOT NULL AND idempotency_key <> '';
UPDATE public.event_orders
   SET unit_price_kobo = total_kobo
 WHERE unit_price_kobo = 0 AND total_kobo > 0;

CREATE INDEX IF NOT EXISTS idx_event_orders_booking
  ON public.event_orders (buyer_id, booking_ref);
CREATE INDEX IF NOT EXISTS idx_event_orders_buyer_created
  ON public.event_orders (buyer_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. event_tickets — attendee name and check-in attribution.
--    checked_in_at already exists (20270194000000_events_stewards.sql); restated
--    here only so this migration is self-sufficient on a partial apply.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS attendee_name   text NOT NULL DEFAULT '';
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS checked_in_at   timestamptz;
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS checked_in_by   uuid REFERENCES auth.users(id);
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS checked_in_gate text NOT NULL DEFAULT '';
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS checkin_method  text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_event_tickets_event_state
  ON public.event_tickets (event_id, state);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. event_refunds — the refund state machine.
--
--   REQUESTED -> APPROVED -> PROCESSING -> REFUNDED
--                            -> FAILED     (explicit admin retry)
--   REQUESTED -> REJECTED
--
-- One live refund per ticket (partial unique index): a second request must not
-- be able to queue a second debit out of escrow. The money legs are keyed on the
-- refund id (evt-refund:<id>:refund / :fee), so a retry of a FAILED/PROCESSING
-- refund dedups through the ledger rather than double-paying.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id)       ON DELETE CASCADE,
  order_id        uuid NOT NULL REFERENCES public.event_orders(id) ON DELETE CASCADE,
  ticket_id       uuid NOT NULL REFERENCES public.event_tickets(id) ON DELETE CASCADE,
  buyer_id        uuid NOT NULL REFERENCES auth.users(id)          ON DELETE CASCADE,
  requested_by    uuid NOT NULL REFERENCES auth.users(id)          ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo >= 0),
  fee_kobo        bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  refund_kobo     bigint NOT NULL DEFAULT 0 CHECK (refund_kobo >= 0),
  reason          text   NOT NULL DEFAULT '',
  status          text   NOT NULL DEFAULT 'REQUESTED'
                  CHECK (status IN ('REQUESTED','APPROVED','REJECTED','PROCESSING','REFUNDED','FAILED')),
  decided_by      uuid REFERENCES auth.users(id),
  decided_at      timestamptz,
  decision_note   text   NOT NULL DEFAULT '',
  failure_reason  text   NOT NULL DEFAULT '',
  idempotency_key text   NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_refunds_ticket_live
  ON public.event_refunds (ticket_id)
  WHERE status IN ('REQUESTED','APPROVED','PROCESSING','REFUNDED');
CREATE INDEX IF NOT EXISTS idx_event_refunds_status_created
  ON public.event_refunds (status, created_at) WHERE status IN ('REQUESTED','PROCESSING','FAILED');
CREATE INDEX IF NOT EXISTS idx_event_refunds_event ON public.event_refunds (event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_refunds_buyer ON public.event_refunds (buyer_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. event_moderation_decisions — append-only review trail.
--    Every submit/approve/reject/request-changes/suspend/reinstate/fee-set is a
--    row. Nothing here rewrites events.state; it records why it changed.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_moderation_decisions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: a FEE_SET decision or an organiser sanction changes no single event,
  -- and the trail still has to record them.
  event_id   uuid REFERENCES public.events(id) ON DELETE CASCADE,
  actor_id   uuid NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN
               ('SUBMIT','APPROVE','REJECT','REQUEST_CHANGES','SUSPEND','REINSTATE','FEE_SET')),
  from_state text NOT NULL DEFAULT '',
  to_state   text NOT NULL DEFAULT '',
  reason     text NOT NULL DEFAULT '',
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_moderation_decisions_event
  ON public.event_moderation_decisions (event_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. event_checkin_log — append-only gate ledger.
--    event_tickets carries the CURRENT check-in; this is the history, including
--    UNDO, so "who let this person in, at which gate, by which method" survives
--    a reversal.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_checkin_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id)        ON DELETE CASCADE,
  ticket_id   uuid NOT NULL REFERENCES public.event_tickets(id) ON DELETE CASCADE,
  actor_id    uuid NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN ('CHECK_IN','UNDO')),
  method      text NOT NULL DEFAULT 'SCAN' CHECK (method IN ('SCAN','MANUAL','SYNC')),
  gate        text NOT NULL DEFAULT '',
  credential_id uuid,
  reason      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_checkin_log_event_created
  ON public.event_checkin_log (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_checkin_log_ticket
  ON public.event_checkin_log (ticket_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. event_fee_settings — the platform fee is ops policy, not client input.
--    Singleton row: a CHECK on the PK keeps exactly one.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_fee_settings (
  id         smallint PRIMARY KEY CHECK (id = 1),
  fee_bps    int NOT NULL DEFAULT 1000 CHECK (fee_bps >= 0 AND fee_bps <= 10000),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.event_fee_settings (id, fee_bps) VALUES (1, 1000)
  ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. event_organiser_sanctions — platform suspension of an organiser.
--    Its own table because organiser_profiles is created lazily (events-social):
--    a sanction has to work on an organiser who has never edited a profile.
--    Absent row = in good standing.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_organiser_sanctions (
  organiser_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  suspended    boolean NOT NULL DEFAULT false,
  reason       text    NOT NULL DEFAULT '',
  decided_by   uuid    REFERENCES auth.users(id),
  decided_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_organiser_sanctions_suspended
  ON public.event_organiser_sanctions (organiser_id) WHERE suspended;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. event_support_cases / event_support_messages — dispute and help desk.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_support_cases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid REFERENCES public.events(id)         ON DELETE CASCADE,
  order_id    uuid REFERENCES public.event_orders(id)   ON DELETE SET NULL,
  ticket_id   uuid REFERENCES public.event_tickets(id)  ON DELETE SET NULL,
  opened_by   uuid NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'OTHER'
              CHECK (kind IN ('REFUND','TICKET','CHECKIN','PAYMENT','CONDUCT','OTHER')),
  subject     text NOT NULL,
  body        text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'OPEN'
              CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  priority    text NOT NULL DEFAULT 'normal'
              CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_support_cases_status
  ON public.event_support_cases (status, priority, created_at) WHERE status IN ('OPEN','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS idx_event_support_cases_opener
  ON public.event_support_cases (opened_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_support_cases_event
  ON public.event_support_cases (event_id) WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_support_messages (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id   uuid NOT NULL REFERENCES public.event_support_cases(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id)                 ON DELETE CASCADE,
  body      text NOT NULL CHECK (body <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_support_messages_case
  ON public.event_support_messages (case_id, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- 10. event_notifications — the customer-facing inbox for this module.
--     order_id is the dedup anchor: a crash-replayed purchase must not mail the
--     buyer the same receipt twice.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  event_id   uuid REFERENCES public.events(id)              ON DELETE CASCADE,
  order_id   uuid REFERENCES public.event_orders(id)        ON DELETE CASCADE,
  refund_id  uuid REFERENCES public.event_refunds(id)       ON DELETE CASCADE,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_notifications_order_kind
  ON public.event_notifications (user_id, order_id, kind) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_notifications_user_unread
  ON public.event_notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Row-level security. ENABLE only, never FORCE, so the backend's owner-role
--     pgx pool (which the whole module runs on) keeps working. These policies
--     govern any future PostgREST/supabase-js access; the service layer is the
--     real enforcement point today.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.event_refunds              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_moderation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_checkin_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_fee_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_organiser_sanctions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_support_cases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_support_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_notifications        ENABLE ROW LEVEL SECURITY;

-- Buyers/organisers read their own rows; admins read everything; every write
-- below is service-role only, because each of these tables is a governance or
-- money-adjacent record the backend must author (never a client PATCH).
DROP POLICY IF EXISTS event_refunds_read ON public.event_refunds;
CREATE POLICY event_refunds_read ON public.event_refunds
  FOR SELECT TO authenticated USING (
    public.is_admin() OR buyer_id = auth.uid() OR requested_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_refunds.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_refunds_service ON public.event_refunds;
CREATE POLICY event_refunds_service ON public.event_refunds
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS event_moderation_decisions_read ON public.event_moderation_decisions;
CREATE POLICY event_moderation_decisions_read ON public.event_moderation_decisions
  FOR SELECT TO authenticated USING (
    public.is_admin() OR actor_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_moderation_decisions.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_moderation_decisions_service ON public.event_moderation_decisions;
CREATE POLICY event_moderation_decisions_service ON public.event_moderation_decisions
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS event_checkin_log_read ON public.event_checkin_log;
CREATE POLICY event_checkin_log_read ON public.event_checkin_log
  FOR SELECT TO authenticated USING (
    public.is_admin() OR actor_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_checkin_log.event_id AND e.organiser_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.event_stewards s WHERE s.event_id = event_checkin_log.event_id AND s.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_checkin_log_service ON public.event_checkin_log;
CREATE POLICY event_checkin_log_service ON public.event_checkin_log
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS event_fee_settings_read ON public.event_fee_settings;
CREATE POLICY event_fee_settings_read ON public.event_fee_settings
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS event_fee_settings_service ON public.event_fee_settings;
CREATE POLICY event_fee_settings_service ON public.event_fee_settings
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS event_organiser_sanctions_read ON public.event_organiser_sanctions;
CREATE POLICY event_organiser_sanctions_read ON public.event_organiser_sanctions
  FOR SELECT TO authenticated USING (public.is_admin() OR organiser_id = auth.uid());
DROP POLICY IF EXISTS event_organiser_sanctions_service ON public.event_organiser_sanctions;
CREATE POLICY event_organiser_sanctions_service ON public.event_organiser_sanctions
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS event_support_cases_read ON public.event_support_cases;
CREATE POLICY event_support_cases_read ON public.event_support_cases
  FOR SELECT TO authenticated USING (
    public.is_admin() OR opened_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_support_cases.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_support_cases_service ON public.event_support_cases;
CREATE POLICY event_support_cases_service ON public.event_support_cases
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS event_support_messages_read ON public.event_support_messages;
CREATE POLICY event_support_messages_read ON public.event_support_messages
  FOR SELECT TO authenticated USING (
    public.is_admin() OR author_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.event_support_cases c
      LEFT JOIN public.events e ON e.id = c.event_id
      WHERE c.id = event_support_messages.case_id
        AND (c.opened_by = auth.uid() OR e.organiser_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS event_support_messages_service ON public.event_support_messages;
CREATE POLICY event_support_messages_service ON public.event_support_messages
  TO service_role USING (true) WITH CHECK (true);

-- The buyer's own inbox only. Notification rows for an organiser are addressed to
-- the organiser's own user id, so the same rule covers both sides.
DROP POLICY IF EXISTS event_notifications_read_own ON public.event_notifications;
CREATE POLICY event_notifications_read_own ON public.event_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS event_notifications_update_own ON public.event_notifications;
CREATE POLICY event_notifications_update_own ON public.event_notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS event_notifications_service ON public.event_notifications;
CREATE POLICY event_notifications_service ON public.event_notifications
  TO service_role USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════════
-- 12. RBAC — events.* . Additive; ON CONFLICT DO NOTHING on both the permission
--     rows and the role grants, mirroring 20260726000200_events.sql.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Refund Events',      'events.refund',     'events','refund',     'process','Approve and execute ticket refunds',        true),
  ('Moderate Events',    'events.moderate',   'events','event',      'moderate','Review submissions: approve/reject/changes',true),
  ('Set Event Fees',     'events.fees',       'events','fee',        'manage', 'Change the platform fee applied to events', true),
  ('Handle Event Support','events.support',   'events','support',    'manage', 'Work event dispute and help cases',         true),
  ('Manage Organisers',  'events.organisers', 'events','organiser',  'manage', 'Suspend or reinstate an organiser',         true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'events.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- system-admin gets the review/ops surface but NOT events.fees (pricing changes
-- stay with super-admin) and not events.manage (it never owns an event).
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('events.refund','events.moderate','events.support','events.organisers'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
