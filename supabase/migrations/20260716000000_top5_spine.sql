-- Paymax Top-5 Phase 1 — Shared spine (scheduler, escrow core, cashtag directory)
-- Ref: docs/estate/TOP5-BUILD-PLAN.md §2 (shared primitives), §5 (state machines),
--      docs/estate/CLAUDE.md NL-1..NL-12.
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY/TRIGGER IF EXISTS is used only to re-create them idempotently.
-- Money is BIGINT kobo. FKs to auth.users(id). RLS on every table with a
-- service_role bypass. Balances are NEVER stored — derived from the finance
-- ledger / append-only sub-ledgers (NL-8). Escrow never lends (NL-1/NL-6), never
-- pays yield (NL-2).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- SCHEDULER — durable recurring jobs (auto-save, Ajo cycles, subscriptions).
-- The scheduler owns scheduling/retry/idempotency; registered handlers own the
-- side effect (which reuses the finance ledger). No external cron dependency.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.scheduler_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type      text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_ref    text NOT NULL DEFAULT '',
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paused','completed','cancelled')),
  interval_secs bigint NOT NULL DEFAULT 0 CHECK (interval_secs >= 0),
  next_run_at   timestamptz NOT NULL DEFAULT now(),
  last_run_at   timestamptz,
  run_count     bigint NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  max_runs      bigint NOT NULL DEFAULT 0 CHECK (max_runs >= 0),
  failure_count int  NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  max_retries   int  NOT NULL DEFAULT 5 CHECK (max_retries >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_due
  ON public.scheduler_jobs (next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_owner
  ON public.scheduler_jobs (owner_user_id, status);

-- Immutable run records — one per (job, occurrence). UNIQUE run_key makes a
-- poller crash / double-invoke a no-op (NL-9: never double-apply).
CREATE TABLE IF NOT EXISTS public.scheduler_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES public.scheduler_jobs(id) ON DELETE CASCADE,
  run_key       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','succeeded','failed')),
  error         text NOT NULL DEFAULT '',
  scheduled_for timestamptz NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduler_run_key ON public.scheduler_runs (run_key);
CREATE INDEX IF NOT EXISTS idx_scheduler_runs_job ON public.scheduler_runs (job_id, scheduled_for DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- ESCROW CORE — generic funds-hold state machine HELD→RELEASED|REFUNDED
-- (+DISPUTED reserved for P3). Ledger-backed via the finance escrow standing
-- account; this table carries ONLY the hold state + domain ref, never a balance.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.escrow_holds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       text NOT NULL DEFAULT '',
  module_type     text NOT NULL DEFAULT '',
  payer_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payee_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  state           text NOT NULL DEFAULT 'HELD'
                    CHECK (state IN ('HELD','RELEASED','REFUNDED','DISPUTED')),
  idempotency_key text NOT NULL,
  held_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_escrow_idem ON public.escrow_holds (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_escrow_payer ON public.escrow_holds (payer_id, state);
CREATE INDEX IF NOT EXISTS idx_escrow_ref   ON public.escrow_holds (reference);

-- ════════════════════════════════════════════════════════════════════════════
-- CASHTAG DIRECTORY — unique @handle per identity (UNIQUE handle AND user).
-- Reserved / impersonation guard enforced in code AND seeded here.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cashtag_handles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  handle     text NOT NULL CHECK (handle ~ '^[a-z0-9][a-z0-9_]{2,29}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashtag_handle ON public.cashtag_handles (handle);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashtag_user   ON public.cashtag_handles (user_id);

-- Reserved handles — abuse / impersonation block list (defence in depth).
CREATE TABLE IF NOT EXISTS public.cashtag_reserved (
  handle text PRIMARY KEY
);
INSERT INTO public.cashtag_reserved (handle) VALUES
  ('paymax'),('admin'),('support'),('official'),('help'),('root'),('system'),
  ('spotlight'),('wallet'),('escrow'),('ajo'),('savings'),('security'),('team'),
  ('staff'),('moderator'),('verify'),('verified'),('payment'),('payments')
ON CONFLICT (handle) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at trigger (reuse public.handle_updated_at()).
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_scheduler_jobs_updated ON public.scheduler_jobs;
CREATE TRIGGER trg_scheduler_jobs_updated BEFORE UPDATE ON public.scheduler_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — owner-scoped reads; service_role full (the engines write
-- via service-role). Mutations are service-role only — no client UPDATE path.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.scheduler_jobs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduler_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_holds     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashtag_handles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashtag_reserved ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduler_jobs_own ON public.scheduler_jobs;
CREATE POLICY scheduler_jobs_own ON public.scheduler_jobs
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS scheduler_jobs_service ON public.scheduler_jobs;
CREATE POLICY scheduler_jobs_service ON public.scheduler_jobs
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS scheduler_runs_own ON public.scheduler_runs;
CREATE POLICY scheduler_runs_own ON public.scheduler_runs
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.scheduler_jobs j
      WHERE j.id = scheduler_runs.job_id AND j.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS scheduler_runs_service ON public.scheduler_runs;
CREATE POLICY scheduler_runs_service ON public.scheduler_runs
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Escrow: payer or payee may read their own holds; admin all; service full.
DROP POLICY IF EXISTS escrow_holds_party ON public.escrow_holds;
CREATE POLICY escrow_holds_party ON public.escrow_holds
  FOR SELECT TO authenticated USING (
    payer_id = auth.uid() OR payee_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS escrow_holds_service ON public.escrow_holds;
CREATE POLICY escrow_holds_service ON public.escrow_holds
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Cashtag handles are a public directory (resolve any handle); owner-write via
-- service-role. Reserved list is admin/service readable only.
DROP POLICY IF EXISTS cashtag_handles_read ON public.cashtag_handles;
CREATE POLICY cashtag_handles_read ON public.cashtag_handles
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS cashtag_handles_service ON public.cashtag_handles;
CREATE POLICY cashtag_handles_service ON public.cashtag_handles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS cashtag_reserved_admin ON public.cashtag_reserved;
CREATE POLICY cashtag_reserved_admin ON public.cashtag_reserved
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS cashtag_reserved_service ON public.cashtag_reserved;
CREATE POLICY cashtag_reserved_service ON public.cashtag_reserved
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — escrow admin oversight (additive; ON CONFLICT DO NOTHING).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Escrow Holds',    'escrow.admin.view',    'escrow','hold','view',   'View escrow funds-holds across users', true),
  ('Resolve Escrow Holds', 'escrow.admin.resolve', 'escrow','hold','manage', 'Release/refund disputed holds (P3)',   true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'escrow.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'escrow.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
