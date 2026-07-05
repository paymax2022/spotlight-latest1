-- Paymax Top-5 Phase 1 — Savings (vaults / Ajo-Esusu / group-target)
-- Ref: docs/estate/BUILD-PLAN.md EPIC 1.3, TOP5-BUILD-PLAN.md §5, CLAUDE.md NL-1,2,7,8,9,12.
--
-- ADDITIVE-ONLY. Money is BIGINT kobo. FKs to auth.users(id). RLS everywhere with
-- a service_role bypass. Sub-balances are append-only ledgers (savings_vault_ledger,
-- group_target_ledger): balance = SUM(entries) (NL-8). NL-2: NO yield column /
-- interest path exists. NL-7: Ajo is peer rotation — there is no Paymax-funded /
-- guarantor column; a recipient is paid only the sum of peer contributions.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- VAULT — wallet sub-balance. Lock/Flex versioned config; OPEN→MATURED|CLOSED.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.savings_vaults (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  kind            text NOT NULL DEFAULT 'FLEX' CHECK (kind IN ('FLEX','LOCK')),
  state           text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','MATURED','CLOSED')),
  target_kobo     bigint NOT NULL DEFAULT 0 CHECK (target_kobo >= 0),
  config_version  int    NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  matures_at      timestamptz,
  autosave_job_id uuid REFERENCES public.scheduler_jobs(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_savings_vaults_owner ON public.savings_vaults (owner_user_id, state);

-- Append-only vault sub-ledger — balance is SUM(CREDIT) - SUM(DEBIT). NL-8.
-- UNIQUE idempotency_key makes a replayed deposit/withdraw a no-op (NL-9).
CREATE TABLE IF NOT EXISTS public.savings_vault_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id        uuid NOT NULL REFERENCES public.savings_vaults(id) ON DELETE CASCADE,
  direction       text NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  reason          text NOT NULL DEFAULT '' CHECK (reason NOT IN ('interest','yield')), -- NL-2 guard
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_savings_vault_ledger_idem ON public.savings_vault_ledger (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_savings_vault_ledger_vault ON public.savings_vault_ledger (vault_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- AJO / ESUSU — peer-rotation circle. FORMING→ACTIVE→COMPLETED|CANCELLED.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ajo_circles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  contribution_kobo bigint NOT NULL CHECK (contribution_kobo > 0),
  interval_secs     bigint NOT NULL CHECK (interval_secs > 0),
  state             text NOT NULL DEFAULT 'FORMING'
                      CHECK (state IN ('FORMING','ACTIVE','COMPLETED','CANCELLED')),
  current_cycle     int  NOT NULL DEFAULT 0 CHECK (current_cycle >= 0),
  total_cycles      int  NOT NULL DEFAULT 0 CHECK (total_cycles >= 0),
  cycle_job_id      uuid REFERENCES public.scheduler_jobs(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ajo_circles_creator ON public.ajo_circles (creator_user_id, state);

-- Member: INVITED→ACTIVE→DEFAULTED|EXITED. One row per (circle,user).
CREATE TABLE IF NOT EXISTS public.ajo_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id      uuid NOT NULL REFERENCES public.ajo_circles(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rotation_order int  NOT NULL DEFAULT 0 CHECK (rotation_order >= 0),
  state          text NOT NULL DEFAULT 'INVITED'
                   CHECK (state IN ('INVITED','ACTIVE','DEFAULTED','EXITED')),
  missed_count   int  NOT NULL DEFAULT 0 CHECK (missed_count >= 0),
  joined_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (circle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ajo_members_circle ON public.ajo_members (circle_id, rotation_order);
CREATE INDEX IF NOT EXISTS idx_ajo_members_user   ON public.ajo_members (user_id);

-- Cycle: one payout per cycle to the scheduled recipient. collected/payout are
-- the realised peer sum (never a Paymax top-up). UNIQUE (circle, cycle_number).
CREATE TABLE IF NOT EXISTS public.ajo_cycles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id      uuid NOT NULL REFERENCES public.ajo_circles(id) ON DELETE CASCADE,
  cycle_number   int  NOT NULL CHECK (cycle_number >= 1),
  recipient_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collected_kobo bigint NOT NULL DEFAULT 0 CHECK (collected_kobo >= 0),
  payout_kobo    bigint NOT NULL DEFAULT 0 CHECK (payout_kobo >= 0),
  status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','PAID')),
  scheduled_for  timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  UNIQUE (circle_id, cycle_number)
);
CREATE INDEX IF NOT EXISTS idx_ajo_cycles_circle ON public.ajo_cycles (circle_id, cycle_number);

-- ════════════════════════════════════════════════════════════════════════════
-- GROUP TARGET — shared goal pot. OPEN→REACHED→RELEASED→CLOSED. Rule ON_DATE|MAJORITY.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.group_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  target_kobo     bigint NOT NULL CHECK (target_kobo > 0),
  withdrawal_rule text NOT NULL DEFAULT 'ON_DATE' CHECK (withdrawal_rule IN ('ON_DATE','MAJORITY')),
  target_date     timestamptz,
  state           text NOT NULL DEFAULT 'OPEN'
                    CHECK (state IN ('OPEN','REACHED','RELEASED','CLOSED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_targets_creator ON public.group_targets (creator_user_id, state);

CREATE TABLE IF NOT EXISTS public.group_target_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES public.group_targets(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approved  boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_target_members_target ON public.group_target_members (target_id);

-- Append-only target pot sub-ledger (NL-8). UNIQUE idempotency_key (NL-9).
CREATE TABLE IF NOT EXISTS public.group_target_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id       uuid NOT NULL REFERENCES public.group_targets(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction       text NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_target_ledger_idem ON public.group_target_ledger (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_group_target_ledger_target ON public.group_target_ledger (target_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers.
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_savings_vaults_updated ON public.savings_vaults;
CREATE TRIGGER trg_savings_vaults_updated BEFORE UPDATE ON public.savings_vaults
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_ajo_circles_updated ON public.ajo_circles;
CREATE TRIGGER trg_ajo_circles_updated BEFORE UPDATE ON public.ajo_circles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_group_targets_updated ON public.group_targets;
CREATE TRIGGER trg_group_targets_updated BEFORE UPDATE ON public.group_targets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — owner/member scoped reads; service_role full writes.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.savings_vaults        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_vault_ledger  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ajo_circles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ajo_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ajo_cycles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_targets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_target_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_target_ledger   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS savings_vaults_own ON public.savings_vaults;
CREATE POLICY savings_vaults_own ON public.savings_vaults
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS savings_vaults_service ON public.savings_vaults;
CREATE POLICY savings_vaults_service ON public.savings_vaults
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS savings_vault_ledger_own ON public.savings_vault_ledger;
CREATE POLICY savings_vault_ledger_own ON public.savings_vault_ledger
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.savings_vaults v
      WHERE v.id = savings_vault_ledger.vault_id AND v.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS savings_vault_ledger_service ON public.savings_vault_ledger;
CREATE POLICY savings_vault_ledger_service ON public.savings_vault_ledger
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Ajo: members of a circle may read it.
DROP POLICY IF EXISTS ajo_circles_member ON public.ajo_circles;
CREATE POLICY ajo_circles_member ON public.ajo_circles
  FOR SELECT TO authenticated USING (
    public.is_admin() OR creator_user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.ajo_members m
      WHERE m.circle_id = ajo_circles.id AND m.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS ajo_circles_service ON public.ajo_circles;
CREATE POLICY ajo_circles_service ON public.ajo_circles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS ajo_members_member ON public.ajo_members;
CREATE POLICY ajo_members_member ON public.ajo_members
  FOR SELECT TO authenticated USING (
    public.is_admin() OR user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.ajo_members m2
      WHERE m2.circle_id = ajo_members.circle_id AND m2.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS ajo_members_service ON public.ajo_members;
CREATE POLICY ajo_members_service ON public.ajo_members
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS ajo_cycles_member ON public.ajo_cycles;
CREATE POLICY ajo_cycles_member ON public.ajo_cycles
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.ajo_members m
      WHERE m.circle_id = ajo_cycles.circle_id AND m.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS ajo_cycles_service ON public.ajo_cycles;
CREATE POLICY ajo_cycles_service ON public.ajo_cycles
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Group target: members may read.
DROP POLICY IF EXISTS group_targets_member ON public.group_targets;
CREATE POLICY group_targets_member ON public.group_targets
  FOR SELECT TO authenticated USING (
    public.is_admin() OR creator_user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.group_target_members gm
      WHERE gm.target_id = group_targets.id AND gm.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS group_targets_service ON public.group_targets;
CREATE POLICY group_targets_service ON public.group_targets
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS group_target_members_member ON public.group_target_members;
CREATE POLICY group_target_members_member ON public.group_target_members
  FOR SELECT TO authenticated USING (
    public.is_admin() OR user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.group_target_members gm2
      WHERE gm2.target_id = group_target_members.target_id AND gm2.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS group_target_members_service ON public.group_target_members;
CREATE POLICY group_target_members_service ON public.group_target_members
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS group_target_ledger_member ON public.group_target_ledger;
CREATE POLICY group_target_ledger_member ON public.group_target_ledger
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.group_target_members gm
      WHERE gm.target_id = group_target_ledger.target_id AND gm.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS group_target_ledger_service ON public.group_target_ledger;
CREATE POLICY group_target_ledger_service ON public.group_target_ledger
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — savings.* (member + admin oversight). Additive; ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Own Vaults',    'savings.vault.manage',  'savings','vault',  'manage', 'Create/deposit/withdraw own vaults',   true),
  ('Manage Own Ajo',       'savings.ajo.manage',    'savings','ajo',    'manage', 'Create/join/run own Ajo circles',      true),
  ('Manage Own Targets',   'savings.target.manage', 'savings','target', 'manage', 'Create/join/contribute group targets', true),
  ('View Savings (Admin)', 'savings.admin.view',    'savings','admin',  'view',   'Ops oversight of savings entities',    true),
  ('Audit Savings (Admin)','savings.admin.audit',   'savings','audit',  'view',   'View savings audit trail',             true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'savings.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'savings.admin.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
