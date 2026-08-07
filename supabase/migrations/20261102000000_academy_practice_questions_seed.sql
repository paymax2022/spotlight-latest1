-- Seed a starter bank of LIVE practice questions into public.academy_question_items.
--
-- The assessment engine (GET /academy/practice, POST /academy/practice/submit,
-- the mastery state machine + progress events) is fully built and grades
-- server-side against the canonical answer key — but academy_question_items was
-- empty, so /practice returned no questions and the whole quiz/mastery loop was
-- dark. This attaches approved MCQ items to existing NERDC-2025 objectives so the
-- learner practice surface serves live content and mastery actually advances.
--
-- Answer shape matches the grader (assessment.isCorrect): answer.correct is
-- compared to the learner's selected.value via equalAny, which normalises with
-- %v. Both sides are single-element arrays (["b"]) so order never matters — every
-- item here is single-answer MCQ by design. explanation rides inside the answer
-- jsonb and is surfaced only after submission (the /practice read strips answer).
--
-- Idempotent: objective_id/subject_id are resolved by natural key (class/subject/
-- objective code within the NERDC-2025 version) so ids match whatever
-- gen_random_uuid produced, and each row is guarded by NOT EXISTS
-- (objective_id, stem) — re-running inserts nothing. Additive-only; status
-- 'approved' so GetApprovedItemsForObjective picks them up.
INSERT INTO public.academy_question_items
  (type, stem, options, answer, difficulty, objective_id, subject_id, status)
SELECT 'mcq', x.stem, x.options::jsonb, x.answer::jsonb, x.difficulty, o.id, s.id, 'approved'
FROM (VALUES
  -- ── JSS1 Mathematics · MTH-INT-1 "Perform operations on integers" ──
  ('JSS1','MTH','MTH-INT-1','What is (-7) + 12?',
   '[{"id":"a","text":"-19"},{"id":"b","text":"5"},{"id":"c","text":"-5"},{"id":"d","text":"19"}]',
   '{"correct":["b"],"explanation":"Adding a positive to a negative moves right on the number line: -7 + 12 = 5."}', 0.35),
  ('JSS1','MTH','MTH-INT-1','What is (-6) x (-4)?',
   '[{"id":"a","text":"-24"},{"id":"b","text":"-10"},{"id":"c","text":"24"},{"id":"d","text":"10"}]',
   '{"correct":["c"],"explanation":"A negative times a negative is positive: 6 x 4 = 24."}', 0.45),
  ('JSS1','MTH','MTH-INT-1','What is 8 - (-3)?',
   '[{"id":"a","text":"5"},{"id":"b","text":"11"},{"id":"c","text":"-11"},{"id":"d","text":"-5"}]',
   '{"correct":["b"],"explanation":"Subtracting a negative is adding its opposite: 8 - (-3) = 8 + 3 = 11."}', 0.5),
  ('JSS1','MTH','MTH-INT-1','What is (-20) divided by 5?',
   '[{"id":"a","text":"4"},{"id":"b","text":"-4"},{"id":"c","text":"-15"},{"id":"d","text":"15"}]',
   '{"correct":["b"],"explanation":"A negative divided by a positive is negative: -20 / 5 = -4."}', 0.4),
  -- ── JSS1 Mathematics · MTH-INT-2 "Solve simple linear equations" ──
  ('JSS1','MTH','MTH-INT-2','Solve for x: x + 5 = 12',
   '[{"id":"a","text":"x = 7"},{"id":"b","text":"x = 17"},{"id":"c","text":"x = -7"},{"id":"d","text":"x = 60"}]',
   '{"correct":["a"],"explanation":"Subtract 5 from both sides: x = 12 - 5 = 7."}', 0.35),
  ('JSS1','MTH','MTH-INT-2','Solve for x: 3x = 21',
   '[{"id":"a","text":"x = 18"},{"id":"b","text":"x = 24"},{"id":"c","text":"x = 7"},{"id":"d","text":"x = 63"}]',
   '{"correct":["c"],"explanation":"Divide both sides by 3: x = 21 / 3 = 7."}', 0.4),
  ('JSS1','MTH','MTH-INT-2','Solve for x: 2x - 4 = 10',
   '[{"id":"a","text":"x = 3"},{"id":"b","text":"x = 7"},{"id":"c","text":"x = 12"},{"id":"d","text":"x = 28"}]',
   '{"correct":["b"],"explanation":"Add 4 to both sides then divide by 2: 2x = 14, x = 7."}', 0.55),
  -- ── P4 English Studies · ENG-GRAM-1 "Use nouns, verbs and adjectives correctly" ──
  ('P4','ENG','ENG-GRAM-1','Which word in this sentence is a verb? "The happy child runs quickly."',
   '[{"id":"a","text":"happy"},{"id":"b","text":"child"},{"id":"c","text":"runs"},{"id":"d","text":"quickly"}]',
   '{"correct":["c"],"explanation":"A verb shows action. \"runs\" is the action the child does."}', 0.35),
  ('P4','ENG','ENG-GRAM-1','Which word is an adjective? "She wore a beautiful dress."',
   '[{"id":"a","text":"She"},{"id":"b","text":"wore"},{"id":"c","text":"beautiful"},{"id":"d","text":"dress"}]',
   '{"correct":["c"],"explanation":"An adjective describes a noun. \"beautiful\" describes the dress."}', 0.4),
  ('P4','ENG','ENG-GRAM-1','Which word is a noun? "The dog barked loudly."',
   '[{"id":"a","text":"dog"},{"id":"b","text":"barked"},{"id":"c","text":"loudly"},{"id":"d","text":"The"}]',
   '{"correct":["a"],"explanation":"A noun names a person, place, animal or thing. \"dog\" is the animal."}', 0.35)
) AS x(class_code, subj_code, obj_code, stem, options, answer, difficulty)
JOIN public.academy_curriculum_versions v ON v.code = 'NERDC-2025'
JOIN public.academy_classes c  ON c.version_id = v.id AND c.code = x.class_code
JOIN public.academy_subjects s ON s.class_id = c.id AND s.code = x.subj_code
JOIN public.academy_topics t   ON t.subject_id = s.id
JOIN public.academy_learning_objectives o ON o.topic_id = t.id AND o.code = x.obj_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.academy_question_items qi
  WHERE qi.objective_id = o.id AND qi.stem = x.stem
);
