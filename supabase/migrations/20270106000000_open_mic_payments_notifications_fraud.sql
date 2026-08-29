-- Paymax super-app — dedicated tables for Open Mic payment events,
-- notifications, and fraud alerts.
--
-- WHY THIS MIGRATION
-- src/server/openmic/persistence.ts's listPaymentEvents/listNotifications/
-- listFraudAlerts read these from public.admin_audit_logs, filtered on a
-- `target_type` column that does not exist (the real column is
-- `target_table`), and the write side (insertOpenMicAuditEvent) inserts
-- admin_user_id/action/target_type/metadata — NONE of which are real columns
-- on admin_audit_logs (it has admin_id/action_type/target_table/target_id/
-- old_value/new_value/reason/ip_address). Every write has been silently
-- swallowed by a bare `catch { return; }` since this code was written, so no
-- Open Mic payment event, notification, or fraud alert has ever actually
-- persisted. admin_audit_logs is also the wrong shape for this regardless of
-- column names: it is a structured before/after audit trail, not a generic
-- JSON event store, and had no column to hold the arbitrary payment/
-- notification/fraud-alert payload these three entities need.
--
-- These three tables replace that misuse. Real, update-able columns instead
-- of the "insert a queryable 'delta' row and merge it client-side" pattern
-- audit-log-as-event-store forced (bulkMarkNotificationsSent /
-- bulkResolveFraudAlerts / bulkUpdatePaymentEventStatus previously operated
-- on the store.ts IN-MEMORY fallback, disconnected from the DB rows the list
-- functions actually read — a second, separate bug this also fixes).
--
-- Additive-only: three new tables, no changes to any existing table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.open_mic_payment_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id        uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  application_id    uuid REFERENCES public.competition_enrollments(id) ON DELETE SET NULL,
  submission_id     uuid REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  event_type        text NOT NULL DEFAULT 'entry_fee'
                       CHECK (event_type IN ('entry_fee', 'vote_payment', 'refund')),
  amount_ngn        integer NOT NULL DEFAULT 0 CHECK (amount_ngn >= 0),
  payment_status    text NOT NULL DEFAULT 'pending'
                       CHECK (payment_status IN ('pending', 'successful', 'failed', 'refunded', 'waived')),
  payment_reference text,
  provider          text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_open_mic_payment_events_contest
  ON public.open_mic_payment_events (contest_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.open_mic_notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id     uuid REFERENCES public.contests(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.competition_enrollments(id) ON DELETE SET NULL,
  submission_id  uuid REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  audience       text NOT NULL DEFAULT 'artist' CHECK (audience IN ('artist', 'admin')),
  channel        text NOT NULL DEFAULT 'in_app'
                    CHECK (channel IN ('in_app', 'email', 'sms_whatsapp_placeholder')),
  event_key      text NOT NULL DEFAULT '',
  title          text NOT NULL DEFAULT '',
  message        text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent')),
  sent_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_open_mic_notifications_contest
  ON public.open_mic_notifications (contest_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.open_mic_fraud_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id      uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  submission_id   uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  severity        text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  reason          text NOT NULL DEFAULT '',
  votes_in_event  integer NOT NULL DEFAULT 0 CHECK (votes_in_event >= 0),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_open_mic_fraud_alerts_contest
  ON public.open_mic_fraud_alerts (contest_id, created_at DESC);

ALTER TABLE public.open_mic_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_mic_notifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_mic_fraud_alerts   ENABLE ROW LEVEL SECURITY;

-- Admin console reads/writes exclusively through the service-role client
-- (createAdminClient in persistence.ts), same as every other Open Mic admin
-- table (competition_enrollments, competition_entries). No authenticated-role
-- policy is needed for that path; is_admin() mirrors the pattern used on
-- competition_beats for any future direct-client access.
CREATE POLICY "admin_manage_open_mic_payment_events" ON public.open_mic_payment_events
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_manage_open_mic_notifications" ON public.open_mic_notifications
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_manage_open_mic_fraud_alerts" ON public.open_mic_fraud_alerts
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMIT;
