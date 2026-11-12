-- Pre-consult intake: give the DB-managed schema its asking-side copy.
--
-- The patient wizard (M4–M11) renders from the active health_intake_schemas row,
-- but that row only ever carried the STORAGE contract ({name,type,required,options}),
-- so the app had nothing to render and each question surfaced as a bare field name.
-- This adds the copy the PRD already specifies as a `ui` block per field. The
-- storage contract is untouched: names, types, required flags and option values are
-- byte-identical to version 1, so validation (intake.validate), the red-flag rules
-- and every persisted answer keep working exactly as before. `ui` is ignored by the
-- validator on purpose — re-wording a label must never change what is accepted.
--
-- Version 2 is a NEW row (the version column is immutable per row: a new version is
-- a new row, UNIQUE(slug,version)); version 1 is deactivated in the same transaction
-- so GetActiveSchemaBySlug cannot pick both.
-- ADDITIVE-ONLY: no DDL, no drops, no narrowing.
BEGIN;

UPDATE public.health_intake_schemas
SET active = false
WHERE slug = 'pre-consult' AND version = 1 AND active = true;

INSERT INTO public.health_intake_schemas (slug, version, kind, schema_json, active) VALUES
  ('pre-consult', 2, 'PRE_CONSULT',
   '[
     {"name":"reason_for_visit","type":"text","required":true,
      "ui":{"step":{"id":"reason","title":"Reason for visit","description":"What would you like help with today?","prdScreen":"M4"},
            "type":"long_text","label":"Describe your main concern","placeholder":"In your own words…","patientReported":true}},
     {"name":"reason_category","type":"select","required":false,"options":["general","skin","respiratory","digestive","mental_health","sexual_health","pain","injury","chronic_followup","other"],
      "ui":{"step":{"id":"reason"},"type":"single_select","label":"Category (optional)","options":[
        {"value":"general","label":"General / feeling unwell"},{"value":"skin","label":"Skin"},{"value":"respiratory","label":"Cough / breathing"},
        {"value":"digestive","label":"Stomach / digestion"},{"value":"mental_health","label":"Mental health"},{"value":"sexual_health","label":"Sexual health"},
        {"value":"pain","label":"Pain"},{"value":"injury","label":"Injury"},{"value":"chronic_followup","label":"Follow-up for a long-term condition"},
        {"value":"other","label":"Other"}]}},
     {"name":"symptom_onset","type":"select","required":true,"options":["today","few_days","about_a_week","few_weeks","over_a_month"],
      "ui":{"step":{"id":"symptom","title":"Symptom detail","description":"Tell us a bit more so the doctor can prepare.","prdScreen":"M5"},
            "type":"single_select","label":"When did it start?","help":"Approximate is fine.","options":[
        {"value":"today","label":"Today"},{"value":"few_days","label":"A few days ago"},{"value":"about_a_week","label":"About a week ago"},
        {"value":"few_weeks","label":"A few weeks ago"},{"value":"over_a_month","label":"More than a month ago"}]}},
     {"name":"symptom_severity","type":"number","required":true,
      "ui":{"step":{"id":"symptom"},"type":"scale","label":"How severe is it right now?","help":"1 = very mild, 10 = worst imaginable","min":1,"max":10,"integer":true,"patientReported":true}},
     {"name":"symptom_better_worse","type":"text","required":false,
      "ui":{"step":{"id":"symptom"},"type":"short_text","label":"What makes it better or worse?","placeholder":"e.g. better after rest, worse with movement"}},
     {"name":"meds_none","type":"bool","required":false,
      "ui":{"step":{"id":"medications","title":"Current medications","description":"Safety-critical — your doctor checks this before prescribing.","prdScreen":"M6"},
            "type":"boolean","label":"I am not currently taking any medications."}},
     {"name":"current_medications","type":"text","required":false,
      "ui":{"step":{"id":"medications"},"type":"long_text","label":"Medications and doses","help":"Include how much and how often, e.g. Amlodipine 5mg once daily.","placeholder":"One per line","patientReported":true,"critical":true}},
     {"name":"allergies_none","type":"bool","required":false,
      "ui":{"step":{"id":"allergies","title":"Allergies","description":"Safety-critical — surfaced to your doctor and any prescription.","prdScreen":"M7"},
            "type":"boolean","label":"I have no known allergies."}},
     {"name":"allergies","type":"text","required":false,
      "ui":{"step":{"id":"allergies"},"type":"long_text","label":"Allergies and the reaction they cause","help":"e.g. penicillin — rash; codeine — nausea; peanuts; latex.","patientReported":true,"critical":true}},
     {"name":"chronic_conditions","type":"text","required":false,
      "ui":{"step":{"id":"chronic","title":"Chronic conditions","description":"Conditions you live with day to day.","prdScreen":"M8"},
            "type":"long_text","label":"Ongoing / chronic conditions","help":"e.g. diabetes, hypertension, asthma.","patientReported":true}},
     {"name":"chronic_other","type":"text","required":false,
      "ui":{"step":{"id":"chronic"},"type":"short_text","label":"Anything else to note","placeholder":"Note any other condition"}},
     {"name":"pregnancy_status","type":"select","required":false,"options":["not_applicable","pregnant","breastfeeding"],
      "ui":{"step":{"id":"pregnancy","title":"Pregnancy / breastfeeding","description":"This affects what can be safely prescribed.","prdScreen":"M9"},
            "type":"single_select","label":"Current status","patientReported":true,"options":[
        {"value":"not_applicable","label":"Not applicable"},{"value":"pregnant","label":"Pregnant"},{"value":"breastfeeding","label":"Breastfeeding"}]}},
     {"name":"smoking","type":"select","required":false,"options":["never","former","current"],
      "ui":{"step":{"id":"lifestyle","title":"Lifestyle","description":"Optional — helps with context.","prdScreen":"M10"},
            "type":"single_select","label":"Smoking","options":[
        {"value":"never","label":"Never"},{"value":"former","label":"Former smoker"},{"value":"current","label":"Current smoker"}]}},
     {"name":"alcohol","type":"select","required":false,"options":["never","occasional","weekly","daily"],
      "ui":{"step":{"id":"lifestyle"},"type":"single_select","label":"Alcohol","options":[
        {"value":"never","label":"Never"},{"value":"occasional","label":"Occasional"},{"value":"weekly","label":"Weekly"},{"value":"daily","label":"Daily"}]}},
     {"name":"temp_c","type":"number","required":false,
      "ui":{"step":{"id":"vitals","title":"Self-reported vitals","description":"All optional — only add what you can measure at home. Skip anything you don’t have the tools for.","prdScreen":"M11"},
            "type":"number","label":"Temperature (°C)","min":30,"max":45,"patientReported":true}},
     {"name":"bp_systolic","type":"number","required":false,
      "ui":{"step":{"id":"vitals"},"type":"number","label":"Blood pressure — top number (mmHg)","placeholder":"e.g. 120","min":60,"max":260,"integer":true,"patientReported":true}},
     {"name":"bp_diastolic","type":"number","required":false,
      "ui":{"step":{"id":"vitals"},"type":"number","label":"Blood pressure — bottom number (mmHg)","placeholder":"e.g. 80","min":30,"max":180,"integer":true,"patientReported":true}},
     {"name":"weight_kg","type":"number","required":false,
      "ui":{"step":{"id":"vitals"},"type":"number","label":"Weight (kg)","min":1,"max":400,"patientReported":true}},
     {"name":"height_cm","type":"number","required":false,
      "ui":{"step":{"id":"vitals"},"type":"number","label":"Height (cm)","min":30,"max":250,"integer":true,"patientReported":true}},
     {"name":"pulse","type":"number","required":false,
      "ui":{"step":{"id":"vitals"},"type":"number","label":"Pulse (bpm)","min":20,"max":250,"integer":true,"patientReported":true}}
   ]'::jsonb,
   true)
ON CONFLICT (slug, version) DO NOTHING;

-- A re-run that hit the ON CONFLICT path above must still leave the new row active,
-- otherwise the seed would sit unused and the wizard would keep reading version 1.
UPDATE public.health_intake_schemas
SET active = true
WHERE slug = 'pre-consult' AND version = 2;

COMMIT;
