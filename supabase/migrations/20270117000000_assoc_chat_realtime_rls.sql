-- ─────────────────────────────────────────────────────────────────────────────
-- Association chat: realtime delivery, gated by the SAME rule the API applies.
--
-- WHY THIS EXISTS
-- ---------------
-- /association/chat could send and read messages but never received one it did
-- not fetch: a member had to leave and re-enter the thread to see a reply. Two
-- independent things blocked live delivery, and fixing either alone does
-- nothing:
--
--   1. assoc_chat_messages was not in the `supabase_realtime` publication, so
--      Postgres emitted no change events for it at all.
--   2. RLS was ENABLED on the table with ZERO policies, so every read through
--      PostgREST/Realtime was denied. Realtime evaluates RLS as the subscribing
--      user, so an unpolicied table delivers nothing even once published.
--
-- THE GATE
-- --------
-- Who may read a thread is not simply "a member of the organisation". The Go
-- service (GetChatThreads / GetChatThread / SendChatMessage) applies a
-- three-part rule, and it is load-bearing — CM-002 and CH-005 are the defects
-- that put it there:
--
--   • an ACTIVE membership in the thread's organisation, AND
--   • EXECUTIVE threads additionally require a role other than 'NONE'
--   • COMMITTEE threads additionally require ACTIVE committee membership
--
-- An RLS policy that checked only organisation membership would be a SUPERSET
-- of that rule, and realtime payloads carry the message body — so an ordinary
-- member would receive the text of executive and committee messages the API
-- deliberately hides from them. That is a data leak, not a cosmetic mismatch.
--
-- So the rule gets ONE definition, assoc_can_read_chat_thread(), and the policy
-- calls it. The Go queries keep their inline copy for now (rewriting the tested
-- money-adjacent query paths is a separate change), but this function is
-- written to match them exactly and is the place to converge on.
--
-- Additive only: creates a function, adds policies to tables that had none, and
-- adds tables to a publication. No DROP, no column change, nothing narrowed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The gate, once ──────────────────────────────────────────────────────────
-- SECURITY DEFINER because the caller is the subscribing end user, who has no
-- policies on assoc_memberships / assoc_member_roles / assoc_committee_members
-- and would therefore read nothing when the function looks them up. The
-- function takes no user-controlled table name and returns only a boolean, so
-- it leaks nothing beyond the yes/no it exists to answer.
CREATE OR REPLACE FUNCTION public.assoc_can_read_chat_thread(p_thread_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM assoc_chat_threads t
    JOIN assoc_memberships v
      ON v.organisation_id = t.organisation_id
     AND v.user_id = p_user_id
     AND v.status = 'ACTIVE'
    WHERE t.id = p_thread_id
      AND (CASE
            WHEN t.scope = 'EXECUTIVE' THEN EXISTS (
              SELECT 1 FROM assoc_member_roles ar
              JOIN assoc_memberships am ON am.id = ar.membership_id
              WHERE am.user_id = p_user_id
                AND am.organisation_id = t.organisation_id
                AND am.status = 'ACTIVE'
                AND ar.role != 'NONE')
            WHEN t.scope = 'COMMITTEE' AND t.committee_id IS NOT NULL THEN EXISTS (
              SELECT 1 FROM assoc_committee_members cm
              JOIN assoc_memberships am ON am.id = cm.membership_id
              WHERE am.user_id = p_user_id
                AND cm.committee_id = t.committee_id
                AND cm.status = 'ACTIVE')
            ELSE true
          END)
  );
$$;

COMMENT ON FUNCTION public.assoc_can_read_chat_thread(uuid, uuid) IS
  'True when the user may read the chat thread: ACTIVE org membership, plus a '
  'role for EXECUTIVE threads and committee membership for COMMITTEE threads. '
  'Mirrors the gate in backend/internal/association/service_ext.go — change both.';

-- ── Read policies ───────────────────────────────────────────────────────────
-- SELECT only. Writes keep going through the Go API, which is where the
-- conditional INSERT and its fail-closed behaviour live; nothing here grants
-- INSERT, UPDATE or DELETE to end users.
DROP POLICY IF EXISTS assoc_chat_messages_select_member ON public.assoc_chat_messages;
CREATE POLICY assoc_chat_messages_select_member
  ON public.assoc_chat_messages
  FOR SELECT
  TO authenticated
  USING (public.assoc_can_read_chat_thread(thread_id, auth.uid()));

DROP POLICY IF EXISTS assoc_chat_threads_select_member ON public.assoc_chat_threads;
CREATE POLICY assoc_chat_threads_select_member
  ON public.assoc_chat_threads
  FOR SELECT
  TO authenticated
  USING (public.assoc_can_read_chat_thread(id, auth.uid()));

-- ── Publish for realtime ────────────────────────────────────────────────────
-- Guarded: adding a table already in the publication is an error, and this
-- migration must stay replayable against a database where a previous run (or a
-- future one) already added it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'assoc_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.assoc_chat_messages;
  END IF;
END $$;

-- REPLICA IDENTITY FULL so an UPDATE or DELETE event carries the old row.
-- Without it a subscriber sees only the primary key on those events and cannot
-- tell which thread they belonged to — which is exactly the filter the client
-- subscribes on.
ALTER TABLE public.assoc_chat_messages REPLICA IDENTITY FULL;
