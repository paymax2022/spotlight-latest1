-- FOOD-UAT-G-011: two-person (maker-checker) approval on restaurant payout runs.
-- Additive-only. Flow: requested -> (endorsed) -> approved, each by a DIFFERENT
-- user; POST /restaurant/admin/payouts/:id/process is refused until 'approved'.
-- Guard: RequirePermission "restaurant.admin.payout_approve" on endorse/approve.
BEGIN;
CREATE TABLE IF NOT EXISTS public.restaurant_payout_approvals (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_run_id  uuid        NOT NULL REFERENCES public.restaurant_payout_runs(id),
  step           text        NOT NULL CHECK (step IN ('requested','endorsed','approved')),
  actor_user_id  uuid        NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_restaurant_payout_approvals_run_step UNIQUE (payout_run_id, step)
);
CREATE INDEX IF NOT EXISTS idx_restaurant_payout_approvals_actor
  ON public.restaurant_payout_approvals (actor_user_id);
ALTER TABLE public.restaurant_payout_approvals ENABLE ROW LEVEL SECURITY;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES ('Approve Restaurant Payouts', 'restaurant.admin.payout_approve', 'restaurant', 'payout_approval', 'approve',
        'Endorse/approve a payout run requested by another admin (POST /restaurant/admin/payouts/:id/endorse|approve)', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r, public.permissions p
 WHERE r.slug IN ('super-admin', 'system-admin')
   AND p.slug = 'restaurant.admin.payout_approve'
ON CONFLICT (role_id, permission_id) DO NOTHING;
COMMIT;
