-- Bus Transport v2 — geography seed: Nigeria's 36 states + FCT.
--
-- ADDITIVE-ONLY. Inserts code+name rows into public.bus_geo_state (created by
-- 20271050000000_bus_transport_v2.sql). Codes follow ISO 3166-2:NG — the same
-- codes the v2 DDL comment cites ('LA','FC','AN'). Idempotent: replay-safe via
-- ON CONFLICT (code) DO NOTHING so a re-applied seed never duplicates or
-- renames rows an admin may have edited.
BEGIN;

INSERT INTO public.bus_geo_state (code, name) VALUES
  ('AB', 'Abia'),
  ('AD', 'Adamawa'),
  ('AK', 'Akwa Ibom'),
  ('AN', 'Anambra'),
  ('BA', 'Bauchi'),
  ('BY', 'Bayelsa'),
  ('BE', 'Benue'),
  ('BO', 'Borno'),
  ('CR', 'Cross River'),
  ('DE', 'Delta'),
  ('EB', 'Ebonyi'),
  ('ED', 'Edo'),
  ('EK', 'Ekiti'),
  ('EN', 'Enugu'),
  ('FC', 'Federal Capital Territory'),
  ('GO', 'Gombe'),
  ('IM', 'Imo'),
  ('JI', 'Jigawa'),
  ('KD', 'Kaduna'),
  ('KN', 'Kano'),
  ('KT', 'Katsina'),
  ('KE', 'Kebbi'),
  ('KO', 'Kogi'),
  ('KW', 'Kwara'),
  ('LA', 'Lagos'),
  ('NA', 'Nasarawa'),
  ('NI', 'Niger'),
  ('OG', 'Ogun'),
  ('ON', 'Ondo'),
  ('OS', 'Osun'),
  ('OY', 'Oyo'),
  ('PL', 'Plateau'),
  ('RI', 'Rivers'),
  ('SO', 'Sokoto'),
  ('TA', 'Taraba'),
  ('YO', 'Yobe'),
  ('ZA', 'Zamfara')
ON CONFLICT (code) DO NOTHING;

COMMIT;
