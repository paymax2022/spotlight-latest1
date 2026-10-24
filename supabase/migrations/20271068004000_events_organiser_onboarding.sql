-- Events & Tickets UAT EVTA-D001 (S1): customer → event-organiser upgrade.
--
-- Routes "become an event organiser" through the platform merchant-onboarding
-- engine (onb_*) — the same apply → review → approve → role-grant pipeline the
-- Health, Marketplace and Food modules use — instead of the old implicit
-- capability (anyone who inserted an events row was its organiser).
--
-- On approval onboarding grants role `event_organiser`, which carries the
-- pre-existing `events.manage` permission (20260726000200_events.sql). The
-- top5events service checks that permission on create / duplicate / submit /
-- go-live when FEATURE_EVENTS_ORGANISER_GATE is on (default off = legacy).
-- Existing organisers are grandfathered by 20271068004010.
--
-- Additive-only and idempotent: INSERT … ON CONFLICT DO NOTHING throughout.
-- No new tables (so no new RLS surface).

-- ─── Role granted on approval + its permission ───────────────────────────────
INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES ('Event Organiser', 'event_organiser',
        'Approved event organiser — may create, submit and publish ticketed events', 'merchant', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p ON p.slug = 'events.manage'
 WHERE r.slug = 'event_organiser'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─── Onboarding module: Events ───────────────────────────────────────────────
INSERT INTO onb_module (id, slug, name, description, icon, icon_color, bg_color, status, sort_order)
VALUES ('mod-events', 'events', 'Events & Tickets',
        'Host ticketed events, sell tickets and run check-in.',
        'Ticket', '#8B5CF6', 'rgba(139,92,246,0.08)', 'open', 4)
ON CONFLICT (id) DO NOTHING;

-- ─── Merchant type: Event Organiser ──────────────────────────────────────────
-- requires_business = false: individual promoters/creators organise events too;
-- the CAC gate (20261002000000) is for trading merchants. Payout KYC is still
-- enforced on the money path (NL-10). The slug is what the app parses back out
-- of workspace_route (/merchant/<slug>) — keep it stable.
INSERT INTO onb_merchant_type (id, module_id, slug, name, description, icon,
    requirements_summary, expected_review_label, required_kyc_tier, role_to_grant,
    current_form_schema_id, status, requires_business)
VALUES
    ('mt-event-organiser', 'mod-events', 'event-organiser', 'Event Organiser',
     'Create events, sell tickets and manage check-in.', 'Ticket',
     '["Organiser or brand name","Government-issued ID","Contact details"]'::jsonb,
     '1–2 business days', 1, 'event_organiser', 'fs-event-organiser-v1', 'open', false)
ON CONFLICT (id) DO NOTHING;

-- ─── Published form schema: fs-event-organiser-v1 ────────────────────────────
INSERT INTO onb_form_schema (id, merchant_type_id, version, status, steps) VALUES
('fs-event-organiser-v1', 'mt-event-organiser', 1, 'published', $json$
[
  {"key":"organiser","title":"About you","description":"Tell us who is hosting.","fields":[
    {"key":"organiser_name","type":"text","label":"Organiser or brand name","placeholder":"Lagos Live Nights","required":true},
    {"key":"event_categories","type":"multiselect","label":"What kind of events?","required":true,"maxSelections":4,"options":[
      {"label":"Music","value":"music"},
      {"label":"Tech","value":"tech"},
      {"label":"Sports","value":"sports"},
      {"label":"Comedy","value":"comedy"},
      {"label":"Faith","value":"faith"},
      {"label":"Other","value":"other"}]},
    {"key":"experience","type":"textarea","label":"Past events (optional)","placeholder":"Links or a short summary","required":false}]},
  {"key":"verification","title":"Verification","description":"We verify these before you can publish.","fields":[
    {"key":"owner_id_doc","type":"document","label":"Government-issued ID","required":true},
    {"key":"contact_email","type":"email","label":"Contact email","required":true},
    {"key":"contact_phone","type":"phone","label":"Contact phone","required":true}]}
]
$json$::jsonb)
ON CONFLICT (id) DO NOTHING;
