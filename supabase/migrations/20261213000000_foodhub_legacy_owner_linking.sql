-- Legacy restaurant-owner linking (foodhub §5.4) — additive-only.
--
-- WHY
-- Every restaurant on the platform predates the merchant-onboarding engine:
-- 1651 restaurants, 1539 distinct owners, and ZERO merchant profiles. That is not
-- cosmetic. Capabilities are read from onb_merchant_profile, so today every one
-- of those owners has no capability card in the app, and /merchant/restaurant
-- resolves to "you don't manage a restaurant yet" — while their tooling works
-- perfectly if they happen to know the direct URL.
--
-- Requiring 1539 people to re-apply for a business they already run is not a
-- migration, it is an outage. This grandfathers them in: a profile, the RBAC
-- role, and the durable link from the shop to the profile.
--
-- A legacy profile is identifiable by application_id IS NULL — it was never
-- applied for. An operator asking "who did we actually review?" must not get an
-- answer polluted by people who were grandfathered.
--
-- SAFETY
-- Additive-only per CLAUDE.md: one nullable column plus idempotent inserts. Every
-- statement is ON CONFLICT DO NOTHING or guarded, so re-running changes nothing.
-- No restaurant, order or ledger row is modified.

-- §5.1: the durable link from a shop to its owner's merchant profile.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS owner_profile_id UUID REFERENCES public.onb_merchant_profile(id);

-- 1. A merchant profile for every restaurant owner that lacks one.
--    application_id stays NULL: nobody applied, and inventing an application
--    would fabricate a review that never happened.
INSERT INTO public.onb_merchant_profile
  (user_id, module_id, merchant_type_id, application_id, role_granted, status, workspace_route, activated_at)
SELECT DISTINCT r.owner_id, 'mod-food', 'mt-restaurant', NULL::uuid, 'restaurant_merchant', 'ACTIVE',
       -- Must match what the app parses back out (app/merchant/[slug].tsx).
       '/merchant/restaurant', now()
FROM public.restaurants r
WHERE r.owner_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.owner_id)
ON CONFLICT (user_id, merchant_type_id) DO NOTHING;

-- 2. The RBAC role, granted the same way onboarding/grant.go does it (by slug,
--    global scope). A profile without the role is a half grant: the hub shows the
--    business while permissioned routes refuse it.
INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
SELECT DISTINCT p.user_id, ro.id, 'global', NULL, true
FROM public.onb_merchant_profile p
JOIN public.roles ro ON ro.slug = 'restaurant_merchant' AND ro.is_active
WHERE p.merchant_type_id = 'mt-restaurant' AND p.status = 'ACTIVE'
ON CONFLICT (user_id, role_id, scope_type, scope_id) DO UPDATE SET is_active = true, updated_at = NOW();

-- 3. Point each shop at its owner's profile. Matched on user_id so a restaurant
--    can never end up attributed to somebody else's merchant record.
UPDATE public.restaurants r
   SET owner_profile_id = p.id
  FROM public.onb_merchant_profile p
 WHERE p.user_id = r.owner_id
   AND p.merchant_type_id = 'mt-restaurant'
   AND p.status = 'ACTIVE'
   AND r.owner_profile_id IS DISTINCT FROM p.id;

COMMENT ON COLUMN public.restaurants.owner_profile_id IS
  'The owning merchant profile (onb_merchant_profile). NULL means unclaimed — see the admin unclaimed queue (foodhub §5.4).';
