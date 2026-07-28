-- Arena competition engine (ADR-014) — RBAC seed.
-- Additive + idempotent only: INSERT ... ON CONFLICT DO NOTHING into the existing
-- permissions / roles / role_permissions tables (see 20260527100000_enterprise_auth_rbac.sql).
-- No DROP, no RENAME, no type narrowing. Safe to re-run.

BEGIN;

-- ── Permissions (module = 'arena') ────────────────────────────────────────────
INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Arena Config',          'arena.admin.config',     'arena', 'competition', 'config',     'Create/publish Arena competitions and versioned config', true),
  ('Arena Screen',          'arena.reviewer.screen',  'arena', 'application',  'screen',     'Review and decide screening applications',               true),
  ('Arena Proctor Attest',  'arena.proctor.attest',   'arena', 'theory_batch', 'attest',     'Attest exam integrity for a theory batch',               true),
  ('Arena Judge Score',     'arena.judge.score',      'arena', 'merit',        'score',      'Submit signed Merit scores via the ScoringGateway',      true),
  ('Arena Transition',      'arena.admin.transition', 'arena', 'contestant',   'transition', 'Execute guarded lifecycle transitions / finalize awards', true),
  ('Arena Auditor Read',    'arena.auditor.read',     'arena', 'merit',        'read',       'Read-only Merit ledger + integrity/audit access',        true),
  ('Arena Disburse',        'arena.admin.disburse',   'arena', 'pot',          'disburse',   'Disburse the prize pot via guarded PotDisbursement',     true),
  ('Arena Credential',      'arena.admin.credential', 'arena', 'credential',   'issue',      'Issue/revoke verifiable Arena credentials',              true),
  ('Arena Sponsor',         'arena.admin.sponsor',    'arena', 'sponsor',      'manage',     'Manage Sponsor rail / Featured Placement',               true)
ON CONFLICT (slug) DO NOTHING;

-- ── Roles ─────────────────────────────────────────────────────────────────────
INSERT INTO public.roles(name, slug, description, role_type, is_system_role)
VALUES
  ('Arena Admin',    'arena-admin',    'Arena competition administration (config, transitions, disbursement, credentials, sponsor)', 'program', true),
  ('Arena Reviewer', 'arena-reviewer', 'Arena screening review queue',                                                                'program', true),
  ('Arena Proctor',  'arena-proctor',  'Arena theory-batch proctoring / attestation',                                                 'program', true),
  ('Arena Judge',    'arena-judge',    'Arena Merit scoring',                                                                         'program', true),
  ('Arena Auditor',  'arena-auditor',  'Arena read-only Merit ledger + audit access',                                                'program', true)
ON CONFLICT (slug) DO NOTHING;

-- ── Role → permission maps ────────────────────────────────────────────────────
-- arena-admin: all arena.admin.* + arena.auditor.read
WITH role_row AS (SELECT id FROM public.roles WHERE slug = 'arena-admin'),
     perms AS (
       SELECT id FROM public.permissions
       WHERE slug IN (
         'arena.admin.config',
         'arena.admin.transition',
         'arena.admin.disburse',
         'arena.admin.credential',
         'arena.admin.sponsor',
         'arena.auditor.read'
       )
     )
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT role_row.id, perms.id FROM role_row, perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- arena-reviewer: arena.reviewer.screen
WITH role_row AS (SELECT id FROM public.roles WHERE slug = 'arena-reviewer'),
     perms AS (SELECT id FROM public.permissions WHERE slug IN ('arena.reviewer.screen'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT role_row.id, perms.id FROM role_row, perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- arena-proctor: arena.proctor.attest
WITH role_row AS (SELECT id FROM public.roles WHERE slug = 'arena-proctor'),
     perms AS (SELECT id FROM public.permissions WHERE slug IN ('arena.proctor.attest'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT role_row.id, perms.id FROM role_row, perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- arena-judge: arena.judge.score
WITH role_row AS (SELECT id FROM public.roles WHERE slug = 'arena-judge'),
     perms AS (SELECT id FROM public.permissions WHERE slug IN ('arena.judge.score'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT role_row.id, perms.id FROM role_row, perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- arena-auditor: arena.auditor.read
WITH role_row AS (SELECT id FROM public.roles WHERE slug = 'arena-auditor'),
     perms AS (SELECT id FROM public.permissions WHERE slug IN ('arena.auditor.read'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT role_row.id, perms.id FROM role_row, perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
