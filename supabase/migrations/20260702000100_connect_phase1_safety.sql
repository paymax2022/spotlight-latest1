-- Paymax Connect — Phase 1 safety + Phase 5 trust (additive-only)
-- Ref: docs/prd/dating/{acceptance.md, compliance.md, data-model.md, api.md}
--
-- Scope owned by the safety/chat/moderation/trust agent:
--   • chat (conversations + messages) — gated "no messaging before mutual match"
--   • moderation decisions + flagged-conversation queue
--   • report/block (block prevents further contact/visibility)
--   • date safety (trusted contacts, date plans, share, check-in, feedback)
--   • Phase 5 trust: scam-shield flags (reason codes), AI assistant log (guardrail audit),
--     group dates + circles with moderation
--
-- Additive-only: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds, no DROP of
-- existing objects, no column renames, no type narrowing. Reuses helpers:
--   public.is_admin()           — admin-role check
--   public.handle_updated_at()  — generic updated_at trigger
-- A sibling owns matching/profiles and ships public.connect_matches /
-- public.connect_profiles (verified: 20260702000000_connect_phase1_core.sql defines
--   connect_matches(id, profile_a, profile_b, status, ...) profile_* → connect_profiles.id
--   connect_profiles(id, user_id UNIQUE → auth.users)).
-- We DO NOT create those here; cross-owned FKs are omitted on match_id to avoid
-- migration-ordering coupling — integrity is enforced in the service layer + the
-- RLS EXISTS checks below, which map auth.uid() to a participant by joining
-- through connect_profiles.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. connect_blocks — block / unmatch. Prevents further contact + visibility.
--    Symmetric in effect: either party blocked hides both directions (enforced
--    by querying both orderings). UNIQUE keeps block idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_blocks_blocker ON public.connect_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_connect_blocks_blocked ON public.connect_blocks (blocked_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. connect_conversations — one per match; carries the safety state machine.
--    safety_state: open → flagged → under_review → restricted → closed.
--    match_id references the sibling-owned connect_matches(id) (FK omitted to
--    avoid cross-owner migration ordering; integrity enforced in service + RLS).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_conversations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     uuid NOT NULL UNIQUE,
  safety_state text NOT NULL DEFAULT 'open'
                 CHECK (safety_state IN ('open','flagged','under_review','restricted','closed')),
  flag_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_conversations_state ON public.connect_conversations (safety_state, updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. connect_messages — immutable message log. Corrections = new rows.
--    Insert is blocked unless conversation is 'open' AND no active block — the
--    DB backstop to the service-layer "no messaging before mutual match" rule.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.connect_conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body            text NOT NULL,
  kind            text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','voice','icebreaker')),
  flagged         boolean NOT NULL DEFAULT false,
  reason_codes    text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_messages_conversation ON public.connect_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_connect_messages_flagged ON public.connect_messages (flagged) WHERE flagged;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. connect_moderation_decisions — AI/human decisions; reason codes stored,
--    moderator-only review (invariant 8). Append-only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_moderation_decisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  text NOT NULL CHECK (target_type IN ('message','conversation','profile','media','user')),
  target_id    text NOT NULL,
  decision     text NOT NULL CHECK (decision IN ('flagged','warned','cleared','restricted','escalated','removed')),
  reason_codes text[] NOT NULL DEFAULT '{}',
  model        text,
  reviewer_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  case_id      uuid REFERENCES public.connect_cases(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_mod_decisions_target ON public.connect_moderation_decisions (target_type, target_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. connect_scam_shield_flags — Phase 5 scam-shield; stores reason codes,
--    surfaced to moderators. Append-only. (invariant 10 + acceptance §Phase 5)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_scam_shield_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.connect_conversations(id) ON DELETE CASCADE,
  message_id      uuid REFERENCES public.connect_messages(id) ON DELETE SET NULL,
  subject_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category        text NOT NULL CHECK (category IN ('financial_solicitation','off_platform','harassment','impersonation','other')),
  reason_codes    text[] NOT NULL DEFAULT '{}',
  score           integer NOT NULL DEFAULT 0,
  case_id         uuid REFERENCES public.connect_cases(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_scam_flags_conv ON public.connect_scam_shield_flags (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_scam_flags_category ON public.connect_scam_shield_flags (category, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. connect_ai_assistant_log — Phase 5 guardrail audit. Every AI coach/assistant
--    response is recorded with the policy verdict so unsafe output is traceable.
--    No raw PII: prompts/outputs are truncated + redacted by the service before insert.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_ai_assistant_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature      text NOT NULL CHECK (feature IN ('profile_coach','conversation_assistant','match_explanation')),
  policy_pass  boolean NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  model        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_ai_log_user ON public.connect_ai_assistant_log (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. connect_trusted_contacts — date-safety center. Contact phone is sensitive
--    PII; owner-only read (no admin read by default), never logged.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_trusted_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  phone        text NOT NULL,
  relationship text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_trusted_contacts_user ON public.connect_trusted_contacts (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. connect_date_plans — planner + check-in lifecycle.
--    checkin_state: planned → shared → checked_in → completed → missed.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_date_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           uuid NOT NULL,
  owner_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idea               text,
  venue              text,
  scheduled_at       timestamptz,
  shared_with_contact boolean NOT NULL DEFAULT false,
  shared_contact_id  uuid REFERENCES public.connect_trusted_contacts(id) ON DELETE SET NULL,
  checkin_state      text NOT NULL DEFAULT 'planned'
                       CHECK (checkin_state IN ('planned','shared','checked_in','completed','missed')),
  checkin_at         timestamptz,
  feedback           jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_date_plans_owner ON public.connect_date_plans (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_date_plans_match ON public.connect_date_plans (match_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. connect_circles — Phase 5 group dates + interest circles with moderation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_circles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind             text NOT NULL DEFAULT 'circle' CHECK (kind IN ('circle','group_date')),
  name             text NOT NULL,
  description      text,
  moderation_state text NOT NULL DEFAULT 'active'
                     CHECK (moderation_state IN ('active','under_review','restricted','closed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_circles_owner ON public.connect_circles (owner_id);
CREATE INDEX IF NOT EXISTS idx_connect_circles_state ON public.connect_circles (moderation_state);

CREATE TABLE IF NOT EXISTS public.connect_circle_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id  uuid NOT NULL REFERENCES public.connect_circles(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','moderator','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (circle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_circle_members_circle ON public.connect_circle_members (circle_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_connect_conversations_updated ON public.connect_conversations;
CREATE TRIGGER trg_connect_conversations_updated
  BEFORE UPDATE ON public.connect_conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_connect_date_plans_updated ON public.connect_date_plans;
CREATE TRIGGER trg_connect_date_plans_updated
  BEFORE UPDATE ON public.connect_date_plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_connect_circles_updated ON public.connect_circles;
CREATE TRIGGER trg_connect_circles_updated
  BEFORE UPDATE ON public.connect_circles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Row Level Security — deny-by-default; service_role bypass for the backend.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.connect_blocks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_moderation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_scam_shield_flags    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_ai_assistant_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_trusted_contacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_date_plans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_circles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_circle_members       ENABLE ROW LEVEL SECURITY;

-- blocks: owner manages own blocks; admin reads all; service bypass.
DROP POLICY IF EXISTS connect_blocks_owner ON public.connect_blocks;
CREATE POLICY connect_blocks_owner ON public.connect_blocks
  FOR ALL TO authenticated
  USING (blocker_id = auth.uid() OR public.is_admin())
  WITH CHECK (blocker_id = auth.uid());
DROP POLICY IF EXISTS connect_blocks_service ON public.connect_blocks;
CREATE POLICY connect_blocks_service ON public.connect_blocks
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- conversations: admins read all (moderation); the all-writes path is service-role
-- (the backend mediates the match check). Participant reads are mediated by the
-- service layer + the connect_messages participant policy below.
DROP POLICY IF EXISTS connect_conversations_admin_read ON public.connect_conversations;
CREATE POLICY connect_conversations_admin_read ON public.connect_conversations
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS connect_conversations_service ON public.connect_conversations;
CREATE POLICY connect_conversations_service ON public.connect_conversations
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- messages: participants of the underlying mutual match read; admins read.
-- Insert requires sender = auth.uid(), an 'open' conversation, AND no active block —
-- the data-layer backstop for "no messaging before mutual match".
-- Participant resolution joins through connect_profiles, since the sibling-owned
-- connect_matches stores profile_a/profile_b (→ connect_profiles.id) and the auth
-- identity lives on connect_profiles.user_id.
DROP POLICY IF EXISTS connect_messages_select_participant ON public.connect_messages;
CREATE POLICY connect_messages_select_participant ON public.connect_messages
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.connect_conversations c
      JOIN public.connect_matches m ON m.id = c.match_id
      JOIN public.connect_profiles p ON p.id IN (m.profile_a, m.profile_b)
      WHERE c.id = connect_messages.conversation_id
        AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_messages_insert_participant ON public.connect_messages;
CREATE POLICY connect_messages_insert_participant ON public.connect_messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.connect_conversations c
      JOIN public.connect_matches m   ON m.id = c.match_id
      JOIN public.connect_profiles ps ON ps.id IN (m.profile_a, m.profile_b) AND ps.user_id = auth.uid()
      JOIN public.connect_profiles po ON po.id IN (m.profile_a, m.profile_b) AND po.id <> ps.id
      WHERE c.id = connect_messages.conversation_id
        AND c.safety_state = 'open'
        AND m.status = 'matched'
        AND NOT EXISTS (
          SELECT 1 FROM public.connect_blocks b
          WHERE (b.blocker_id = ps.user_id AND b.blocked_id = po.user_id)
             OR (b.blocker_id = po.user_id AND b.blocked_id = ps.user_id))));
DROP POLICY IF EXISTS connect_messages_service ON public.connect_messages;
CREATE POLICY connect_messages_service ON public.connect_messages
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- moderation decisions: admin/moderator read only; service writes. (invariant 8)
DROP POLICY IF EXISTS connect_mod_decisions_admin_read ON public.connect_moderation_decisions;
CREATE POLICY connect_mod_decisions_admin_read ON public.connect_moderation_decisions
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS connect_mod_decisions_service ON public.connect_moderation_decisions;
CREATE POLICY connect_mod_decisions_service ON public.connect_moderation_decisions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- scam-shield flags: admin/moderator read only; service writes. (invariant 10)
DROP POLICY IF EXISTS connect_scam_flags_admin_read ON public.connect_scam_shield_flags;
CREATE POLICY connect_scam_flags_admin_read ON public.connect_scam_shield_flags
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS connect_scam_flags_service ON public.connect_scam_shield_flags;
CREATE POLICY connect_scam_flags_service ON public.connect_scam_shield_flags
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ai assistant log: owner reads own; admin reads all; service writes.
DROP POLICY IF EXISTS connect_ai_log_owner_read ON public.connect_ai_assistant_log;
CREATE POLICY connect_ai_log_owner_read ON public.connect_ai_assistant_log
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_ai_log_service ON public.connect_ai_assistant_log;
CREATE POLICY connect_ai_log_service ON public.connect_ai_assistant_log
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- trusted contacts: STRICTLY owner-only (sensitive PII; no admin read). service writes.
DROP POLICY IF EXISTS connect_trusted_contacts_owner ON public.connect_trusted_contacts;
CREATE POLICY connect_trusted_contacts_owner ON public.connect_trusted_contacts
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_trusted_contacts_service ON public.connect_trusted_contacts;
CREATE POLICY connect_trusted_contacts_service ON public.connect_trusted_contacts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- date plans: owner manages own; admin reads (safety escalation); service writes.
DROP POLICY IF EXISTS connect_date_plans_owner ON public.connect_date_plans;
CREATE POLICY connect_date_plans_owner ON public.connect_date_plans
  FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS connect_date_plans_service ON public.connect_date_plans;
CREATE POLICY connect_date_plans_service ON public.connect_date_plans
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- circles: members read; owner/moderator manage; admin reads; service writes.
DROP POLICY IF EXISTS connect_circles_member_read ON public.connect_circles;
CREATE POLICY connect_circles_member_read ON public.connect_circles
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid() OR public.is_admin() OR EXISTS (
      SELECT 1 FROM public.connect_circle_members cm
      WHERE cm.circle_id = connect_circles.id AND cm.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_circles_owner_write ON public.connect_circles;
CREATE POLICY connect_circles_owner_write ON public.connect_circles
  FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS connect_circles_service ON public.connect_circles;
CREATE POLICY connect_circles_service ON public.connect_circles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS connect_circle_members_read ON public.connect_circle_members;
CREATE POLICY connect_circle_members_read ON public.connect_circle_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_admin() OR EXISTS (
      SELECT 1 FROM public.connect_circles c
      WHERE c.id = connect_circle_members.circle_id AND c.owner_id = auth.uid()));
DROP POLICY IF EXISTS connect_circle_members_service ON public.connect_circle_members;
CREATE POLICY connect_circle_members_service ON public.connect_circle_members
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Seed Phase-1/5 backend-owned config (idempotent). Thresholds/weights live
--     here — NEVER hard-coded in service code (CLAUDE.md: config-driven).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.connect_config (key, value, scope, visibility, description) VALUES
  ('safety.warning.off_platform_terms',
     '["whatsapp","telegram","signal","snapchat","instagram","my number","text me","kik","email me"]'::jsonb,
     'global', 'internal',
     'Off-platform redirection terms for inline chat warnings (invariant 4/10)'),
  ('safety.warning.harassment_terms',
     '["kill yourself","kys","slut","whore","worthless","i know where you live"]'::jsonb,
     'global', 'internal',
     'Harassment/abuse trigger terms for inline chat warnings'),
  ('safety.scam_shield.flag_to_case_threshold', '2'::jsonb, 'global', 'internal',
     'Number of flags in a conversation before a connect_case is auto-opened'),
  ('safety.scam_shield.escalate_score', '5'::jsonb, 'global', 'internal',
     'Cumulative scam-shield score that escalates a conversation to under_review')
ON CONFLICT (key) DO NOTHING;

COMMIT;
