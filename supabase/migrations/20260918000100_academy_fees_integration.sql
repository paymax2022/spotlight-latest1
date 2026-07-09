-- 20260918000100_academy_fees_integration.sql
-- EdTech School Fees — integration seed. Additive-only (no DROP / rename / type-narrow).
--
-- Two parts:
--   (A) RBAC seed for the EdTech-fees capability set: roles + permissions +
--       role_permissions grants, into the existing enterprise RBAC tables
--       (public.roles / public.permissions / public.role_permissions from
--       20260527100000_enterprise_auth_rbac.sql). Slug convention module.resource.action.
--       Every write is ON CONFLICT DO NOTHING — no existing row is modified.
--   (B) Additive tables the fees backend packages reported needing but which the core
--       fees migration (20260918000000_academy_fees_edtech.sql) did not create:
--         - public.academy_hardship_requests   (fees/hardship — human review, no money)
--         - public.academy_school_compliance_optins (fees/export — data-category opt-in)
--         - public.academy_scholarship_pledges  (fees/scholarship — pledge spine)
--         - public.academy_fees_trust_overrides (fees/trustscore — admin override store)
--       + additive ALTERs on academy_scholarship_awards (pledge_id, invoice_payment_id).
--
-- Reuses Paymax rails: finance/ledger (money — every money mutation posts a balanced
-- ledger entry, NEVER handled in these tables), academy/edupay (fee schedules/pots),
-- academy/identity (guardian links/consent), academy/gamification (leaderboards).
-- All new tables are RLS-locked (deny-all for anon/authenticated; the backend reaches
-- them as owner and bypasses RLS), guarded with to_regclass like the T0.2 lockdown.
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- (A) RBAC SEED
-- ═══════════════════════════════════════════════════════════════════════════════

-- A1. Roles ---------------------------------------------------------------------
INSERT INTO public.roles (name, slug, description, role_type, is_system_role) VALUES
  ('School Owner',          'school-owner',          'Owns a school tenant; full fees admin for that school', 'admin', true),
  ('Bursar',                'bursar',                'Manages fees collections/invoices/payments for a school (no role assignment, no promotion approval)', 'admin', true),
  ('Class Teacher',         'class-teacher',         'Enters scores, proposes promotions', 'admin', true),
  ('Head Teacher',          'head-teacher',          'Second promotion approval; school-admin fees oversight', 'admin', true),
  ('Guardian',              'guardian',              'Parent/guardian capability (member-side fees)', 'user', true),
  ('Student',               'student',               'Minor-safe learner capability (member-side)', 'user', true),
  ('Platform EdTech Admin', 'platform-edtech-admin', 'Paymax platform operator for EdTech (super-admin scope)', 'admin', true)
ON CONFLICT (slug) DO NOTHING;

-- A2. Permissions ---------------------------------------------------------------
-- Slugs marked [enforced] are checked in a fees handler today
-- (middleware.RequirePermission / RequireScopedPermission / competition guard).
-- The others are canonical role-capability slugs (issue/approve) documented in
-- REUSE-MAP §3 and used by the admin console; all module='academy'.
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission) VALUES
  ('Verify School',            'academy.fees.school.verify',        'academy', 'school',      'verify',   'Verify a school (school admin) [enforced]',              true),
  ('Assign Fees Staff Role',   'academy.fees.roles.assign',         'academy', 'roles',       'assign',   'Assign/revoke school-scoped fees staff roles [enforced]', true),
  ('Manage Competition',       'academy.fees.competition.manage',   'academy', 'competition', 'manage',   'Create/transition a cross-school competition [enforced]', true),
  ('Register Competition School','academy.fees.competition.register','academy', 'competition', 'register', 'Register a school into a competition [enforced]',        true),
  ('Score Competition',        'academy.fees.competition.score',    'academy', 'competition', 'score',    'Record competition scores [enforced]',                  true),
  ('Run Compliance Export',    'academy.fees.export.run',           'academy', 'export',      'run',      'Trigger compliance / school-data export (SF-11) [enforced]', true),
  ('View Trust Score',         'academy.fees.trustscore.view',      'academy', 'trustscore',  'view',     'View + override school trust score (T9.1) [enforced]',   true),
  ('Manage Scholarship',       'academy.fees.scholarship.manage',   'academy', 'scholarship', 'manage',   'Oversee sponsor pledges/awards (T9.2)',                 true),
  ('Issue Invoice',            'academy.fees.invoice.issue',        'academy', 'invoice',     'issue',    'Issue a fee invoice (bursar capability)',               true),
  ('Approve Promotion',        'academy.fees.promotion.approve',    'academy', 'promotion',   'approve',  'Approve a promotion step (SF-3 two-approval)',          true),
  ('Platform EdTech Admin',    'platform_edtech_admin',             'academy', 'platform',    'view',     'Platform EdTech super-admin surface (directory, fraud, config)', true)
ON CONFLICT (slug) DO NOTHING;

-- A3. Grant EVERYTHING (all academy.fees.* + platform_edtech_admin) to super-admin
--     (bypass covers super-admin anyway; kept complete/visible) ------------------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug LIKE 'academy.fees.%' OR slug = 'platform_edtech_admin'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- A4. Grant EVERYTHING (incl. platform perm) to platform-edtech-admin -----------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug LIKE 'academy.fees.%' OR slug = 'platform_edtech_admin'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'platform-edtech-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- A5. school-owner + head-teacher: full school-admin fees perms (NOT the platform perm) --
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'academy.fees.school.verify',
    'academy.fees.roles.assign',
    'academy.fees.competition.manage',
    'academy.fees.competition.register',
    'academy.fees.competition.score',
    'academy.fees.export.run',
    'academy.fees.trustscore.view',
    'academy.fees.scholarship.manage',
    'academy.fees.invoice.issue',
    'academy.fees.promotion.approve'
  )
), r AS (
  SELECT id FROM public.roles WHERE slug IN ('school-owner','head-teacher')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r CROSS JOIN p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- A6. bursar: collections/invoice/payment perms — NOT roles.assign, NOT promotion.approve --
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'academy.fees.invoice.issue',
    'academy.fees.export.run',
    'academy.fees.scholarship.manage',
    'academy.fees.trustscore.view'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'bursar'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- A7. class-teacher: score entry only (proposes promotions; second approval is head-teacher) --
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN ('academy.fees.competition.score')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'class-teacher'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- A8. head-teacher: also the promotion.approve capability is granted in A5 above.
--     guardian + student get member-side capability via their role only — the
--     member fees routes gate on RequireAuthContext + ownership, not admin perms,
--     so no admin role_permissions are granted to guardian/student here (their
--     capability is the role membership itself, mirroring REUSE-MAP §3).

-- ═══════════════════════════════════════════════════════════════════════════════
-- (B) ADDITIVE TABLES (reported by the fees backend packages)
-- ═══════════════════════════════════════════════════════════════════════════════

-- B1. Hardship review queue (fees/hardship — SF-9). Holds NO money. Columns match
--     fees/hardship/repository.go: id, invoice_id, guardian_user_id, reason,
--     requested_at, status, reviewed_by, reviewed_at, review_note.
CREATE TABLE IF NOT EXISTS public.academy_hardship_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL,
  guardian_user_id uuid NOT NULL,
  reason           text NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_note      text
);
CREATE INDEX IF NOT EXISTS idx_academy_hardship_invoice ON public.academy_hardship_requests(invoice_id);
CREATE INDEX IF NOT EXISTS idx_academy_hardship_status  ON public.academy_hardship_requests(status);

-- B2. School data-category opt-ins (fees/export — SF-11 compliance export gate).
CREATE TABLE IF NOT EXISTS public.academy_school_compliance_optins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL,
  data_category text NOT NULL,
  opted_in_at   timestamptz NOT NULL DEFAULT now(),
  opted_in_by   uuid,
  UNIQUE (school_id, data_category)
);
CREATE INDEX IF NOT EXISTS idx_academy_compliance_optin_school ON public.academy_school_compliance_optins(school_id);

-- B3. Scholarship pledges (fees/scholarship). Columns match
--     fees/scholarship/repository.go InsertPledge/GetPledge:
--     id, sponsor_identity_id, target_student_id, amount_minor, applied_minor,
--     currency, state, fund_ledger_ref, created_at. Money is bigint minor units;
--     applied_minor is a running total maintained under the award-insert tx (never a
--     ledger balance — the ledger remains the source of truth for settled money).
CREATE TABLE IF NOT EXISTS public.academy_scholarship_pledges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_identity_id uuid,
  target_student_id   uuid NOT NULL,
  amount_minor        bigint NOT NULL CHECK (amount_minor >= 0),
  applied_minor       bigint NOT NULL DEFAULT 0 CHECK (applied_minor >= 0),
  currency            text NOT NULL DEFAULT 'NGN',
  state               text NOT NULL DEFAULT 'pledged'
                        CHECK (state IN ('pledged','funded','partially_applied','applied','cancelled')),
  fund_ledger_ref     text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_pledge_student ON public.academy_scholarship_pledges(target_student_id);
CREATE INDEX IF NOT EXISTS idx_academy_pledge_sponsor ON public.academy_scholarship_pledges(sponsor_identity_id);

-- B4. Trust-score admin overrides (fees/trustscore.OverrideStore). Append-only
--     history; latest (by created_at) wins on read.
CREATE TABLE IF NOT EXISTS public.academy_fees_trust_overrides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL,
  actor_id   uuid,
  score      double precision NOT NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_trust_override_school ON public.academy_fees_trust_overrides(school_id, created_at DESC);

-- B5. Additive ALTERs on the reused awards table so awards can reference a pledge
--     and the invoice payment they were applied against (fees/scholarship report).
DO $awards$ BEGIN
  IF to_regclass('public.academy_scholarship_awards') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.academy_scholarship_awards ADD COLUMN IF NOT EXISTS pledge_id uuid';
    EXECUTE 'ALTER TABLE public.academy_scholarship_awards ADD COLUMN IF NOT EXISTS invoice_payment_id uuid';
  END IF;
END $awards$;

-- ── Backend-only RLS lockdown for every new table (deny-all for anon/authenticated;
--    owner/service_role bypass). Guarded with to_regclass + pg_roles like T0.2. ──
DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.academy_hardship_requests',
    'public.academy_school_compliance_optins',
    'public.academy_scholarship_pledges',
    'public.academy_fees_trust_overrides'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON %s FROM anon', t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON %s FROM authenticated', t);
      END IF;
    END IF;
  END LOOP;
END $rls$;

COMMIT;
