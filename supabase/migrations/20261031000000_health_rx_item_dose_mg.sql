-- RX-004 / defect T-001: structured single-dose (mg) on a prescription item, so the
-- clinicalsafety dose-range check can be ENFORCED at the Issue boundary. The
-- free-text `dosage` sig stays for the label; `dose_mg` is the machine-checkable
-- amount fed to the safety engine.
--
-- ADDITIVE-ONLY: one nullable-with-default numeric column; existing rows keep
-- dose_mg = 0 (dose check skipped for them, unchanged behaviour). No DROP, no
-- rename, no type narrowing.

ALTER TABLE public.health_prescription_items
  ADD COLUMN IF NOT EXISTS dose_mg double precision NOT NULL DEFAULT 0
    CHECK (dose_mg >= 0);
