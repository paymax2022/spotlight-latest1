-- Events & Tickets UAT EVTA-D001: grandfather existing event organisers.
--
-- Once FEATURE_EVENTS_ORGANISER_GATE is on, creating / submitting / publishing
-- an event needs RBAC events.manage, which onboarding approval grants via role
-- `event_organiser` (20271068004000). Everyone who ALREADY owns an event is an
-- organiser in practice, so they get that role — plus an ACTIVE onboarding
-- merchant profile, so /me/capabilities shows their organiser workspace and the
-- onboarding duplicate-check stops them re-applying for a role they hold.
--
-- Idempotent, NULLS-safe, revocation-safe:
--   * Ownership is COALESCE(organiser_id, organizer_id): events carries BOTH
--     spellings after the June legacy CMS / July Top-5 drift reconciliation
--     (20270228000000), and legacy rows may have organiser_id NULL.
--   * Only users present in public.platform_users — the actual FK target of
--     user_roles.user_id — are granted. The auth.users→platform_users bridge
--     skips email-NULL identities, so checking auth.users could pick a user
--     the INSERT then fails on, aborting the whole sweep.
--   * A user with ANY global user_roles row for the role — active or revoked —
--     is skipped, so a re-run never resurrects a revoked organiser. ON CONFLICT
--     DO NOTHING is backed by user_roles_unique_nulls_not_distinct
--     (20271068000040) for the global (scope_id IS NULL) case.
--   * Profiles use UNIQUE (user_id, merchant_type_id) → ON CONFLICT DO NOTHING,
--     and are only created where the role grant is also possible.
-- The backend re-runs the same statements at boot when the flag is on
-- (top5events.GrandfatherOrganisers) to cover events created after this ran.
-- Additive-only: INSERTs only.

INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
SELECT o.user_id, r.id, 'global', NULL, true
  FROM (SELECT DISTINCT COALESCE(e.organiser_id, e.organizer_id) AS user_id
          FROM public.events e
         WHERE COALESCE(e.organiser_id, e.organizer_id) IS NOT NULL) o
 CROSS JOIN (SELECT id FROM public.roles WHERE slug = 'event_organiser' AND is_active) r
 WHERE EXISTS (SELECT 1 FROM public.platform_users p WHERE p.id = o.user_id)
   AND NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = o.user_id AND ur.role_id = r.id
          AND ur.scope_type = 'global' AND ur.scope_id IS NULL)
ON CONFLICT DO NOTHING;

INSERT INTO onb_merchant_profile
    (user_id, module_id, merchant_type_id, application_id, role_granted, status, workspace_route, activated_at)
SELECT DISTINCT o.user_id, 'mod-events', 'mt-event-organiser', NULL::uuid,
       'event_organiser', 'ACTIVE', '/merchant/event-organiser', NOW()
  FROM (SELECT DISTINCT COALESCE(e.organiser_id, e.organizer_id) AS user_id
          FROM public.events e
         WHERE COALESCE(e.organiser_id, e.organizer_id) IS NOT NULL) o
 WHERE EXISTS (SELECT 1 FROM public.platform_users p WHERE p.id = o.user_id)
   AND EXISTS (SELECT 1 FROM onb_merchant_type mt WHERE mt.id = 'mt-event-organiser')
ON CONFLICT (user_id, merchant_type_id) DO NOTHING;
