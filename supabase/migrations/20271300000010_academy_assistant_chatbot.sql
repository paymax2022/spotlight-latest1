-- 20271300000010_academy_assistant_chatbot.sql
-- Timeless Movies Film Academy — Academy Assistant (AI FAQ chatbot + human handoff).
--
-- Additive-only: CREATE TABLE / ADD COLUMN / CREATE INDEX / enable RLS. No DROP, no
-- RENAME, no type narrowing, no policy on a pre-existing table is replaced here.
-- No money path: nothing in this module moves value, and every fee/date/eligibility
-- answer that has not been approved by the academy stays a draft.
--
-- Reuse over duplication:
--   * `academy_support_tickets` (20260505110000_film_academy_admin_ops.sql) already
--     existed with an admin `FOR ALL` policy and carried ZERO application code. The
--     assistant's handoff writes into that table rather than creating a second ticket
--     system, and gets a link back to the conversation via one added nullable column.
--   * `academy_feature_flags` (20260924000000) gains one row; the composition root
--     consults it over the compile-time default, fail-closed, exactly as it does for
--     the eight existing academy.* keys.
--   * `public.permissions` / `roles` / `role_permissions` are seeded the same
--     idempotent way 20271068003010_support_impersonation.sql does it.
--
-- Per-user budget lives in Redis (fixed windows, mirroring the doctor AI guard in
-- backend/internal/doctor/service_ai.go) rather than a quota table: a persisted
-- counter would need its own RLS story and reset job for no additional protection,
-- since a user cannot reach the Redis keys either way.
--
-- FAQ seeds are INSERTED AS DRAFTS. The academy has not signed off on the wording
-- (see the spec's "Review, then publish" column and its Pending rows), and the
-- publish CHECK below is what makes "never expose a Pending answer" a database
-- guarantee rather than a convention. supabase/seeds/academy_assistant_dev_faqs.sql
-- publishes them for local/staging rehearsal only; it is deliberately NOT listed in
-- supabase/config.toml [db.seed].sql_paths, so `db reset` never promotes it.

BEGIN;

-- ─── academy_faqs — the curated, editable knowledge base ──────────────────────
CREATE TABLE IF NOT EXISTS public.academy_faqs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 80),
  question    text NOT NULL CHECK (char_length(question) BETWEEN 3 AND 500),
  answer      text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 8000),
  keywords    text[] NOT NULL DEFAULT '{}',
  published   boolean NOT NULL DEFAULT false,
  -- Soft delete: retrieval drops the row, the audit trail keeps it.
  deleted_at  timestamptz,
  updated_by  uuid,                                    -- auth.users(id); nullable for seed
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- An unanswered FAQ must not be publishable. Blocks the placeholder shapes the
  -- seed draft uses ("Pending: insert approved fee schedule", "TO BE APPROVED")
  -- while leaving a legitimate answer containing the word "pending" — "your
  -- application is pending" — freely publishable. Anchored on the colon, which is
  -- what distinguishes the two.
  CONSTRAINT academy_faqs_publishable CHECK (
    published = FALSE
    OR (
      char_length(btrim(answer)) >= 20
      AND answer !~* '(^|[^a-z])pending[[:space:]]*:'
      AND answer !~* 'to[[:space:]]+be[[:space:]]+approved'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_academy_faqs_published ON public.academy_faqs(published) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_academy_faqs_category  ON public.academy_faqs(category);

-- ─── academy_assistant_conversations ──────────────────────────────────────────
-- mode is the switch the spec turns on: while a conversation is `human`, the
-- model is never called and the student's messages accumulate for staff.
CREATE TABLE IF NOT EXISTS public.academy_assistant_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode       text NOT NULL DEFAULT 'bot' CHECK (mode IN ('bot', 'human')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academy_assistant_conv_user ON public.academy_assistant_conversations(user_id, updated_at DESC);

-- ─── academy_assistant_messages ───────────────────────────────────────────────
-- sender drives the bubble on the student screen: You / Academy AI / Academy
-- Staff / Support Update. `faq_ids` records which published entries grounded an
-- assistant turn, so an answer can be audited back to its source after the fact.
CREATE TABLE IF NOT EXISTS public.academy_assistant_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.academy_assistant_conversations(id) ON DELETE CASCADE,
  sender          text NOT NULL CHECK (sender IN ('user', 'assistant', 'staff', 'system')),
  body            text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  faq_ids         uuid[] NOT NULL DEFAULT '{}',
  flagged         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academy_assistant_msg_conv ON public.academy_assistant_messages(conversation_id, created_at);

-- ─── academy_support_tickets: link, do not duplicate ──────────────────────────
-- Nullable and additive: rows written by any other producer (there are none today)
-- stay valid. `last_staff_reply_at` is what makes "unanswered" answerable without
-- scanning the message tree per queue row.
ALTER TABLE public.academy_support_tickets
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.academy_assistant_conversations(id) ON DELETE SET NULL;

ALTER TABLE public.academy_support_tickets
  ADD COLUMN IF NOT EXISTS last_staff_reply_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_academy_tickets_conversation ON public.academy_support_tickets(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_academy_tickets_open ON public.academy_support_tickets(status, created_at DESC);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- Doctrine: a student's app key can only ever see published FAQs and its own
-- conversation, and can only insert its own `user` messages. Drafts, assistant
-- turns, staff turns, ticket writes and the retrieval path all run through the
-- Go backend, which connects as service_role and is gated by RBAC permissions
-- (academy.faq.manage / academy.support.view / academy.support.manage) before a
-- query is ever issued. Hiding the admin screens in Expo is not security; these
-- policies are the boundary that holds when someone bypasses them.
--
-- `public.is_admin()` is already the schema's staff test and is already used in
-- policies on the academy tables (20260505110000), so admin draft visibility reuses
-- it rather than re-deriving a role join here.

ALTER TABLE public.academy_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_assistant_messages ENABLE ROW LEVEL SECURITY;

-- FAQs: signed-in users read published rows only; admins additionally read drafts.
DROP POLICY IF EXISTS academy_faqs_student_read ON public.academy_faqs;
CREATE POLICY academy_faqs_student_read ON public.academy_faqs
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND (published = TRUE OR public.is_admin()));

-- Deliberately NO insert/update/delete policy for `authenticated`: a non-admin —
-- or an admin — using the app's own key cannot modify an official answer. FAQ
-- writes go through the RBAC-gated API, which is also where the publish CHECK is
-- reported as a 400 rather than a driver error.

DROP POLICY IF EXISTS academy_faqs_service_write ON public.academy_faqs;
CREATE POLICY academy_faqs_service_write ON public.academy_faqs
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- Conversations: strictly owner-scoped.
DROP POLICY IF EXISTS academy_assistant_conv_owner ON public.academy_assistant_conversations;
CREATE POLICY academy_assistant_conv_owner ON public.academy_assistant_conversations
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS academy_assistant_conv_service ON public.academy_assistant_conversations;
CREATE POLICY academy_assistant_conv_service ON public.academy_assistant_conversations
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- Messages: a student reads its own transcript and appends only `user` turns. The
-- sender and created_by checks are what stop a normal app client from
-- impersonating Academy AI or Academy Staff.
DROP POLICY IF EXISTS academy_assistant_msg_student_read ON public.academy_assistant_messages;
CREATE POLICY academy_assistant_msg_student_read ON public.academy_assistant_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.academy_assistant_conversations c
     WHERE c.id = academy_assistant_messages.conversation_id
       AND c.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS academy_assistant_msg_student_write ON public.academy_assistant_messages;
CREATE POLICY academy_assistant_msg_student_write ON public.academy_assistant_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender = 'user'
    AND created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.academy_assistant_conversations c
       WHERE c.id = academy_assistant_messages.conversation_id
         AND c.user_id = (SELECT auth.uid())
    )
  );

-- No UPDATE policy for `authenticated`: `flagged` and staff turns are backend writes.

DROP POLICY IF EXISTS academy_assistant_msg_service ON public.academy_assistant_messages;
CREATE POLICY academy_assistant_msg_service ON public.academy_assistant_messages
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- Tickets keep the 20260505110000 admin `FOR ALL` policy untouched. A student never
-- reads the ticket row directly — the ticket is the staff queue's view of a
-- conversation the student already owns.

-- ─── Permissions and staff roles ──────────────────────────────────────────────
-- Seeded with NO members. Membership is granted by privileged administration
-- only; nothing here lets a user hand themselves a staff or admin role.
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Academy FAQ manage', 'academy.faq.manage', 'academy', 'faq', 'manage',
   'Create, edit, publish, unpublish and retire Academy Assistant knowledge-base entries', true),
  ('Academy support view', 'academy.support.view', 'academy', 'support_ticket', 'view',
   'Read the Academy Support ticket queue and the conversations behind it', true),
  ('Academy support manage', 'academy.support.manage', 'academy', 'support_ticket', 'manage',
   'Reply to Academy Support tickets and move their status; cannot edit official FAQ answers', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES
  ('Academy Assistant Admin', 'academy-assistant-admin',
   'Owns the Academy knowledge base and the support queue', 'admin', true),
  ('Academy Support Agent', 'academy-assistant-support',
   'Works the Academy support queue only — holds no FAQ write', 'admin', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r, public.permissions p
 WHERE r.slug = 'academy-assistant-admin'
   AND p.slug IN ('academy.faq.manage', 'academy.support.view', 'academy.support.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r, public.permissions p
 WHERE r.slug = 'academy-assistant-support'
   AND p.slug IN ('academy.support.view', 'academy.support.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─── Runtime feature flag ─────────────────────────────────────────────────────
-- Fail-closed default, matching every other academy.* row and the config.go
-- default for FEATURE_ACADEMY_ASSISTANT_ENABLED.
INSERT INTO public.academy_feature_flags (key, enabled, description)
VALUES
  ('academy.assistant', false,
   'Academy Assistant: AI FAQ answers grounded in published entries, plus human-support handoff')
ON CONFLICT (key) DO NOTHING;

-- ─── Starting knowledge base (drafts, unpublished) ────────────────────────────
-- From the integration spec's initial content. Status is draft because academy
-- administration has not confirmed the wording — particularly the cohort-specific
-- commitments (two movie projects, hostel, certificates). The three genuinely
-- unknown entries (tuition figures, intake dates, address/contact) are seeded with
-- an explicit Pending placeholder so an admin cannot mistake the absence for a
-- finished answer.
--
-- Inserted only when the category+question pair is absent, so re-running never
-- duplicates and never overwrites an admin's edits.

INSERT INTO public.academy_faqs (category, question, answer, keywords, published)
SELECT s.category, s.question, s.answer, s.keywords, false
  FROM (VALUES
    ('registration', 'How do I register?',
     'Registration is completed online using the Spotlight app. Go to the Film Academy registration area and follow the on-screen instructions.',
     ARRAY['register', 'registration', 'sign up', 'signup', 'apply', 'enrol', 'enroll']),
    ('courses', 'What courses are offered?',
     'Training areas include scriptwriting and storytelling, cinematography, video technology and post-production, lighting and sound, and practical film production.',
     ARRAY['course', 'courses', 'training areas', 'what do you teach', 'curriculum', 'areas', 'programmes']),
    ('courses', 'Is the training hands-on?',
     'The academy emphasises hands-on training, industry mentorship and participation in real film projects. Specific assignments depend on the cohort schedule.',
     ARRAY['hands-on', 'practical', 'mentorship', 'experience', 'practicals']),
    ('production', 'Will students participate in film projects?',
     'The programme is designed to involve students in two movie projects during the training period. Confirm the production plan for the current cohort.',
     ARRAY['movie project', 'film project', 'production', 'shoot', 'projects', 'casting']),
    ('facilities', 'Is hostel accommodation available?',
     'The academy has boarding/hostel facilities. Availability, eligibility, terms and charges must be confirmed by admissions.',
     ARRAY['hostel', 'boarding', 'accommodation', 'stay', 'facilities']),
    ('certificate', 'Will I get a certificate?',
     'Students who successfully complete the applicable training requirements receive certificates. Confirm exact completion criteria with admissions.',
     ARRAY['certificate', 'certification', 'completion', 'graduation', 'diploma']),
    ('career', 'Will I get movie roles after training?',
     'Movie roles, contracts and employment are not automatic or guaranteed. Opportunities and possible talent-management arrangements are subject to selection and assessment.',
     ARRAY['roles', 'acting roles', 'job', 'jobs', 'employment', 'career', 'contract', 'talent', 'guarantee']),
    ('support', 'How do I contact the academy?',
     'Use the Talk to Academy Support button inside Spotlight for questions requiring a member of staff.',
     ARRAY['contact', 'support', 'talk to', 'human', 'phone', 'email', 'reach', 'help']),
    ('fees', 'How much is tuition?',
     'PENDING: insert the approved, current fee schedule and the payment and refund rules.',
     ARRAY['fee', 'fees', 'tuition', 'price', 'cost', 'how much', 'payment']),
    ('dates', 'When is the next intake?',
     'PENDING: insert confirmed start dates, the application deadline and cohort information.',
     ARRAY['intake', 'next cohort', 'start date', 'deadline', 'when', 'commence']),
    ('eligibility', 'What are the age and entry requirements?',
     'PENDING: insert the approved eligibility rules and the documents required to apply.',
     ARRAY['requirement', 'requirements', 'age', 'entry', 'eligibility', 'who can apply', 'documents']),
    ('location', 'Where is the academy located?',
     'PENDING: insert the verified street address, directions and contact options.',
     ARRAY['location', 'address', 'where', 'directions', 'map']),
    ('payments', 'Can I pay in instalments?',
     'PENDING: insert the approved payment options and instalment rules.',
     ARRAY['instalment', 'installment', 'instalments', 'pay', 'payment', 'split'])
  ) AS s(category, question, answer, keywords)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.academy_faqs f
    WHERE f.category = s.category AND f.question = s.question
 );

COMMIT;
