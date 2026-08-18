-- Per-outlet restaurant staff (foodhub A18) — additive-only.
--
-- WHY
-- Authority over a restaurant is a single column today: restaurants.owner_id,
-- checked by assertOwner. That works for one person with one shop, and breaks the
-- moment a brand runs several outlets — 61 owners already run 2–3. The owner
-- cannot let a branch manager edit that branch's menu, or a cashier accept
-- orders, without handing over the account that also controls banking.
--
-- A grant is per (restaurant, user), so a manager at Lekki has no authority at
-- Ikeja. Authority follows the shop, not the brand.
--
-- OWNER rows are SYSTEM-MANAGED: they mirror restaurants.owner_id, and the staff
-- API refuses to grant or revoke them. Two sources of truth for who owns a shop
-- is how ownership checks start disagreeing with payouts.
--
-- SAFETY
-- Additive-only per CLAUDE.md: a new table plus a backfill, no change to
-- restaurants or orders. Nothing reads this table until the resolver is wired,
-- and the backfill makes the resolver's answer identical to assertOwner's for
-- every existing owner — so this migration alone changes no behaviour.

CREATE TABLE IF NOT EXISTS public.restaurant_staff (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  invited_by        UUID REFERENCES auth.users(id),
  -- Only the HASH of an invite token is stored: the token itself goes to the
  -- invitee, and a leaked table must not let anyone accept someone else's invite.
  invite_token_hash TEXT,
  accepted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One grant per person per outlet. Two live grants would make "what may this
  -- person do here" ambiguous, and ambiguity in an authorization check resolves
  -- in whichever direction the query happens to sort.
  CONSTRAINT restaurant_staff_unique_member UNIQUE (restaurant_id, user_id),
  CONSTRAINT restaurant_staff_role_check
    CHECK (role IN ('OWNER','MANAGER','CASHIER','KITCHEN','RIDER')),
  CONSTRAINT restaurant_staff_status_check
    CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REMOVED'))
);

-- The hot path is "what may this user do at this outlet", and the staff list per
-- outlet.
CREATE INDEX IF NOT EXISTS restaurant_staff_user_idx       ON public.restaurant_staff (user_id, status);
CREATE INDEX IF NOT EXISTS restaurant_staff_restaurant_idx ON public.restaurant_staff (restaurant_id, status);

-- Backfill: every existing owner becomes the OWNER of their outlets, so role
-- resolution returns exactly what assertOwner returns today. Idempotent via the
-- unique constraint, so re-running is a no-op rather than a duplicate.
INSERT INTO public.restaurant_staff (restaurant_id, user_id, role, status, accepted_at)
SELECT r.id, r.owner_id, 'OWNER', 'ACTIVE', now()
FROM public.restaurants r
WHERE r.owner_id IS NOT NULL
ON CONFLICT (restaurant_id, user_id) DO NOTHING;

COMMENT ON TABLE public.restaurant_staff IS
  'Per-outlet staff grants. OWNER rows mirror restaurants.owner_id and are system-managed; the staff API grants only MANAGER/CASHIER/KITCHEN/RIDER.';
