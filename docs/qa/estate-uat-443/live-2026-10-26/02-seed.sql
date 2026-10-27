-- Local-dev seed for the estate guard-authz / visitor API_LIVE lane.
-- Fixed UUIDs so the script is repeatable; additive only, ON CONFLICT DO NOTHING.
-- Identities come from 01-identities.sh (auth.users created through the GoTrue admin API).
BEGIN;

INSERT INTO estates (id, name, admin_id)
VALUES ('0a1e5701-0000-4000-8000-000000000001', 'UAT Gate Estate Alpha', '7945fbd0-24bf-4ee0-9de4-de37aa51fa21')
ON CONFLICT (id) DO NOTHING;

INSERT INTO estate_residents (estate_id, user_id, unit, role) VALUES
  ('0a1e5701-0000-4000-8000-000000000001', '7945fbd0-24bf-4ee0-9de4-de37aa51fa21', 'A-000', 'estate_admin'),
  ('0a1e5701-0000-4000-8000-000000000001', '2448c98f-d030-4e58-a1f3-75c5a4348630', 'A-101', 'resident'),
  ('0a1e5701-0000-4000-8000-000000000001', 'f30648f3-1e07-48f8-9cdf-d458799946d7', 'A-102', 'resident')
ON CONFLICT (estate_id, user_id) DO UPDATE SET role = EXCLUDED.role, unit = EXCLUDED.unit;

INSERT INTO estate_gates (id, estate_id, name, gate_type) VALUES
  ('0a1e5701-0000-4000-8000-000000000101', '0a1e5701-0000-4000-8000-000000000001', 'Main Gate', 'vehicle'),
  ('0a1e5701-0000-4000-8000-000000000102', '0a1e5701-0000-4000-8000-000000000001', 'Service Gate', 'pedestrian')
ON CONFLICT (id) DO NOTHING;

COMMIT;

SELECT 'estates='||count(*) FROM estates WHERE id='0a1e5701-0000-4000-8000-000000000001'
UNION ALL SELECT 'residents='||count(*) FROM estate_residents WHERE estate_id='0a1e5701-0000-4000-8000-000000000001'
UNION ALL SELECT 'gates='||count(*) FROM estate_gates WHERE estate_id='0a1e5701-0000-4000-8000-000000000001';
