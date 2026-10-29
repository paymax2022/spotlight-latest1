-- =============================================================================
-- Events & Ticketing — commerce, governance and customer-protection layer.
--
-- Implements the gaps identified against the UAT workplan
-- (docs/events/UAT-IMPLEMENTATION-MAP.md):
--   * discovery by city, buyer-facing refund policy and check-in window
--   * server-authoritative order snapshots (tier name, promo, discount) so a
--     receipt can never be rebuilt from client-supplied totals
--   * customer refund requests + admin decision queue with an immutable record
--   * event moderation decisions with a reason (approve/reject/request changes)
--   * append-only check-in log (manual check-in + reversal, staff attribution)
--   * platform fee schedule with prospective effective dates
--   * organiser suspension/reinstatement (merchant governance)
--   * customer-support cases and messages
--   * in-app transactional notifications
--
-- SAFETY: additive-only per CLAUDE.md. New nullable/defaulted columns and new
-- tables only. No DROP, no rename, no type narrowing. Re-runnable (IF NOT EXISTS,
-- DROP POLICY IF EXISTS before CREATE POLICY, guarded permission seeds).
-- This migration is additive and safe to apply against a live database; it does
-- not delete or rewrite learner, buyer, ticket or ledger records.
-- =============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. EVENT — discovery + buyer-protection policy fields.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_address text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS refund_policy text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS refund_cutoff_hours int NOT NULL DEFAULT 24;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS checkin_opens_minutes int NOT NULL DEFAULT 360;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS checkin_closes_minutes int NOT NULL DEFAULT 120;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS moderation_note text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS moderation_decided_by uuid REFERENCES auth.users(id);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS moderation_decided_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_events_city_state_starts
  ON public.events (city, state, starts_at);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. ORDER — frozen line snapshot used by receipts and refunds.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS tier_name text NOT NULL DEFAULT '';
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS promo_code text NOT NULL DEFAULT '';
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS unit_price_kobo bigint NOT NULL DEFAULT 0;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS discount_kobo bigint NOT NULL DEFAULT 0;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS buyer_name text NOT NULL DEFAULT '';
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS attendee_name text NOT NULL DEFAULT '';
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS booking_ref text NOT NULL DEFAULT '';
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS refunded_kobo bigint NOT NULL DEFAULT 0;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill line snapshots for existing orders without rewriting totals.
UPDATE public.event_orders o
SET unit_price_kobo = o.total_kobo
WHERE o.unit_price_kobo = 0 AND o.status IN ('PAID','REFUNDED');

-- booking_ref groups the per-seat orders of one checkout (the batch path keys
-- each seat "<base>:<i>", the single path keeps "<base>" verbatim). The receipt
-- reads one booking group; the backfill reproduces the runtime derivation.
UPDATE public.event_orders
SET booking_ref = regexp_replace(idempotency_key, ':[0-9]+$', '')
WHERE booking_ref = '';

CREATE INDEX IF NOT EXISTS idx_event_orders_booking
  ON public.event_orders (buyer_id, booking_ref);

UPDATE public.event_orders o
SET tier_name = COALESCE(t.name, '')
FROM public.event_ticket_tiers t
WHERE t.id = o.tier_id AND o.tier_name = '';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. TICKET — attendee details + check-in attribution.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS attendee_name text NOT NULL DEFAULT '';
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES auth.users(id);
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS checked_in_gate text NOT NULL DEFAULT '';
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS checkin_method text NOT NULL DEFAULT '';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. REFUND REQUESTS — one active request per ticket, immutable decision trail.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_refunds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES public.event_orders(id) ON DELETE CASCADE,
  ticket_id        uuid NOT NULL REFERENCES public.event_tickets(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  buyer_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by     uuid NOT NULL REFERENCES auth.users(id),
  reason           text NOT NULL DEFAULT '',
  amount_kobo      bigint NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  status           text NOT NULL DEFAULT 'REQUESTED'
                     CHECK (status IN ('REQUESTED','APPROVED','REJECTED','PROCESSING','REFUNDED','FAILED')),
  decision_reason  text NOT NULL DEFAULT '',
  decided_by       uuid REFERENCES auth.users(id),
  decided_at       timestamptz,
  refund_reference text NOT NULL DEFAULT '',
  failure_reason   text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One live/refunded request per ticket. Rejected requests may be re-opened by a
-- new request only after the organiser/admin has resolved the original, which is
-- why REJECTED is excluded from the uniqueness domain (the ticket state itself
-- still has to be issuable).
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_refunds_ticket_live
  ON public.event_refunds (ticket_id)
  WHERE status IN ('REQUESTED','APPROVED','PROCESSING','REFUNDED');
CREATE INDEX IF NOT EXISTS idx_event_refunds_buyer ON public.event_refunds (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_refunds_queue ON public.event_refunds (status, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. MODERATION — append-only decision history (the audit trail admins read).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_moderation_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  actor_id    uuid NOT NULL REFERENCES auth.users(id),
  action      text NOT NULL CHECK (action IN ('SUBMIT','APPROVE','REJECT','REQUEST_CHANGES','SUSPEND','REINSTATE','FEE_SET')),
  reason      text NOT NULL DEFAULT '',
  from_state  text NOT NULL DEFAULT '',
  to_state    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_moderation_event ON public.event_moderation_decisions (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_moderation_created ON public.event_moderation_decisions (created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. CHECK-IN LOG — append-only; the source for attendance analytics + reversal.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_checkin_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES public.event_tickets(id) ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES auth.users(id),
  action     text NOT NULL CHECK (action IN ('CHECK_IN','UNDO')),
  method     text NOT NULL DEFAULT 'SCAN' CHECK (method IN ('SCAN','MANUAL','SYNC')),
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_checkin_event ON public.event_checkin_log (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_checkin_ticket ON public.event_checkin_log (ticket_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. PLATFORM FEE SCHEDULE — prospective, effective-dated, admin-only.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_fee_settings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_bps        int NOT NULL CHECK (fee_bps >= 0 AND fee_bps <= 10000),
  effective_from timestamptz NOT NULL,
  note           text NOT NULL DEFAULT '',
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (effective_from)
);

INSERT INTO public.event_fee_settings (fee_bps, effective_from, note)
SELECT 1000, now(), 'Initial platform fee (10%)'
WHERE NOT EXISTS (SELECT 1 FROM public.event_fee_settings);

-- ════════════════════════════════════════════════════════════════════════════
-- 8. ORGANISER GOVERNANCE — suspension is a status, never a deletion.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.organiser_profiles ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE public.organiser_profiles ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id);
ALTER TABLE public.organiser_profiles ADD COLUMN IF NOT EXISTS suspension_reason text NOT NULL DEFAULT '';

-- ════════════════════════════════════════════════════════════════════════════
-- 9. SUPPORT CASES — booking-linked customer protection.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_support_cases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference    text NOT NULL UNIQUE,
  event_id     uuid REFERENCES public.events(id) ON DELETE SET NULL,
  order_id     uuid REFERENCES public.event_orders(id) ON DELETE SET NULL,
  opened_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opened_role  text NOT NULL DEFAULT 'CUSTOMER' CHECK (opened_role IN ('CUSTOMER','ORGANISER')),
  category     text NOT NULL DEFAULT 'OTHER',
  subject      text NOT NULL,
  description  text NOT NULL DEFAULT '',
  priority     text NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0','P1','P2')),
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  assigned_to  uuid REFERENCES auth.users(id),
  sla_due_at   timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  resolution   text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_event_support_owner ON public.event_support_cases (opened_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_support_queue ON public.event_support_cases (status, priority, created_at);

CREATE TABLE IF NOT EXISTS public.event_support_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES public.event_support_cases(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES auth.users(id),
  body       text NOT NULL,
  internal   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_support_messages_case ON public.event_support_messages (case_id, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- 10. TRANSACTIONAL NOTIFICATIONS — durable in-app outbox.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   uuid REFERENCES public.events(id) ON DELETE CASCADE,
  order_id   uuid REFERENCES public.event_orders(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_notifications_order_kind
  ON public.event_notifications (user_id, order_id, kind)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_notifications_user ON public.event_notifications (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- 11. RLS — backend writes over the owner connection; these policies protect
--     any future PostgREST/supabase-js access. Deny-by-default for buyers on
--     other buyers' rows.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.event_refunds                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_moderation_decisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_checkin_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_fee_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_support_cases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_support_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_notifications          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_refunds_read ON public.event_refunds;
CREATE POLICY event_refunds_read ON public.event_refunds
  FOR SELECT TO authenticated USING (
    buyer_id = auth.uid() OR public.is_admin() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_refunds.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_refunds_service ON public.event_refunds;
CREATE POLICY event_refunds_service ON public.event_refunds
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_moderation_read ON public.event_moderation_decisions;
CREATE POLICY event_moderation_read ON public.event_moderation_decisions
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_moderation_decisions.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_moderation_service ON public.event_moderation_decisions;
CREATE POLICY event_moderation_service ON public.event_moderation_decisions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_checkin_read ON public.event_checkin_log;
CREATE POLICY event_checkin_read ON public.event_checkin_log
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_checkin_log.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_checkin_service ON public.event_checkin_log;
CREATE POLICY event_checkin_service ON public.event_checkin_log
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_fee_settings_read ON public.event_fee_settings;
CREATE POLICY event_fee_settings_read ON public.event_fee_settings
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS event_fee_settings_service ON public.event_fee_settings;
CREATE POLICY event_fee_settings_service ON public.event_fee_settings
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_support_cases_read ON public.event_support_cases;
CREATE POLICY event_support_cases_read ON public.event_support_cases
  FOR SELECT TO authenticated USING (opened_by = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS event_support_cases_service ON public.event_support_cases;
CREATE POLICY event_support_cases_service ON public.event_support_cases
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_support_messages_read ON public.event_support_messages;
CREATE POLICY event_support_messages_read ON public.event_support_messages
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.event_support_cases c
      WHERE c.id = event_support_messages.case_id AND c.opened_by = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_support_messages_service ON public.event_support_messages;
CREATE POLICY event_support_messages_service ON public.event_support_messages
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_notifications_own ON public.event_notifications;
CREATE POLICY event_notifications_own ON public.event_notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS event_notifications_service ON public.event_notifications;
CREATE POLICY event_notifications_service ON public.event_notifications
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- 12. RBAC — new least-privilege permissions for the governance surface.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Refund Event Orders',   'events.refund',      'events','refund',    'refund',    'Approve or reject ticket refunds',             true),
  ('Moderate Event Listings','events.moderate',   'events','event',     'moderate',  'Reject or request changes to an event listing', true),
  ('Manage Event Fees',     'events.fees',        'events','fee',       'manage',    'Maintain the platform ticket fee schedule',     true),
  ('Handle Event Support',  'events.support',     'events','support',   'manage',    'Handle booking complaints and disputes',        true),
  ('Manage Organisers',     'events.organisers',  'events','organiser', 'manage',    'Suspend or reinstate event organisers',         true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'events.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('events.refund','events.moderate','events.fees','events.support','events.organisers'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
