-- DP-004: prescription refills.
--
-- A prescriber may authorize refills on a prescription; the medication may then be
-- dispensed that many ADDITIONAL times beyond the initial fill, and no more. Refills
-- are a separate counter that leaves the HL-3 dispense-once guard (the partial
-- UNIQUE index uq_health_rx_dispensed) completely intact — the initial dispense is
-- unchanged; refills are extra fills tracked here.
--
-- ADDITIVE-ONLY: both columns are defaulted, so every existing prescription keeps
-- refills_authorized = 0 / refills_used = 0 (i.e. dispense-once, unchanged). No
-- DROP, no rename, no type narrowing, and the dispense-once index is untouched.

ALTER TABLE public.health_prescriptions
  ADD COLUMN IF NOT EXISTS refills_authorized int NOT NULL DEFAULT 0
    CHECK (refills_authorized >= 0);

ALTER TABLE public.health_prescriptions
  ADD COLUMN IF NOT EXISTS refills_used int NOT NULL DEFAULT 0
    CHECK (refills_used >= 0);
