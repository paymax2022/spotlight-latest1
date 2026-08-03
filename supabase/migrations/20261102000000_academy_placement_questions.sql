-- Curriculum-grounded placement questions for the academy onboarding quiz.
--
-- Seeds approved MCQ items into academy_question_items, each tied to a real
-- NERDC-2025 learning objective (and its subject) so the placement engine can
-- assemble a per-subject diagnostic for the learner's class. Covers the four
-- entry classes P1/P4/JSS1/SSS1 (the classes that currently have curriculum
-- content); the remaining classes are seeded in a follow-up slice.
--
-- Additive + idempotent: each INSERT is guarded by NOT EXISTS on
-- (objective, 'placement' tag, stem), so re-running adds nothing.

DO $$
DECLARE
  q record;
BEGIN
  FOR q IN
    SELECT * FROM (VALUES
      -- ── P1 (Lower Primary) ──────────────────────────────────────────────
      ('P1','ENG-PHONICS-1','Which word starts with the /b/ sound?',
        '[{"id":"a","text":"ball"},{"id":"b","text":"apple"},{"id":"c","text":"cat"},{"id":"d","text":"egg"}]','a',
        'The /b/ sound begins the word "ball".',0.25),
      ('P1','MTH-NUM-1','Which number comes just after 49?',
        '[{"id":"a","text":"48"},{"id":"b","text":"50"},{"id":"c","text":"60"},{"id":"d","text":"40"}]','b',
        'Counting up, 50 comes right after 49.',0.25),
      ('P1','BSC-LIVING-1','Which of these is a LIVING thing?',
        '[{"id":"a","text":"a rock"},{"id":"b","text":"a tree"},{"id":"c","text":"a chair"},{"id":"d","text":"a spoon"}]','b',
        'A tree grows and needs water and air — it is living.',0.3),

      -- ── P4 (Upper Primary → Common Entrance) ────────────────────────────
      ('P4','ENG-GRAM-1','Which word is the VERB in: "The boy runs fast"?',
        '[{"id":"a","text":"boy"},{"id":"b","text":"runs"},{"id":"c","text":"fast"},{"id":"d","text":"the"}]','b',
        'A verb shows action; "runs" is the action.',0.35),
      ('P4','MTH-FRAC-1','What is 1/4 + 1/4?',
        '[{"id":"a","text":"1/2"},{"id":"b","text":"1/8"},{"id":"c","text":"2/16"},{"id":"d","text":"1/4"}]','a',
        'Same denominator: add the tops — 1/4 + 1/4 = 2/4 = 1/2.',0.4),
      ('P4','BST-MATTER-1','Which of these is a GAS at room temperature?',
        '[{"id":"a","text":"water"},{"id":"b","text":"ice"},{"id":"c","text":"oxygen"},{"id":"d","text":"stone"}]','c',
        'Oxygen is a gas; water is liquid, ice and stone are solids.',0.4),

      -- ── JSS1 (Junior Secondary → BECE) ──────────────────────────────────
      ('JSS1','ENG-ESSAY-2','A good paragraph is built around one main idea called the:',
        '[{"id":"a","text":"topic sentence"},{"id":"b","text":"heading"},{"id":"c","text":"caption"},{"id":"d","text":"footnote"}]','a',
        'The topic sentence states the paragraph''s main idea.',0.45),
      ('JSS1','MTH-INT-1','What is (-3) + 5?',
        '[{"id":"a","text":"2"},{"id":"b","text":"-2"},{"id":"c","text":"8"},{"id":"d","text":"-8"}]','a',
        'Moving 5 up from -3 lands on 2.',0.45),
      ('JSS1','MTH-INT-2','Solve for x:  x + 7 = 12',
        '[{"id":"a","text":"5"},{"id":"b","text":"19"},{"id":"c","text":"-5"},{"id":"d","text":"7"}]','a',
        'Subtract 7 from both sides: x = 5.',0.5),
      ('JSS1','BSC-CELL-1','Which part of the cell controls its activities?',
        '[{"id":"a","text":"nucleus"},{"id":"b","text":"cell wall"},{"id":"c","text":"vacuole"},{"id":"d","text":"cytoplasm"}]','a',
        'The nucleus is the control centre of the cell.',0.5),

      -- ── SSS1 (Senior Secondary → WASSCE/NECO/UTME) ──────────────────────
      ('SSS1','ENG-SUMM-1','The best summary of a passage keeps only the:',
        '[{"id":"a","text":"main points"},{"id":"b","text":"examples"},{"id":"c","text":"dialogue"},{"id":"d","text":"adjectives"}]','a',
        'A summary retains the main points and drops the detail.',0.5),
      ('SSS1','MTH-QUAD-1','Solve:  x² − 5x + 6 = 0',
        '[{"id":"a","text":"x = 2 or 3"},{"id":"b","text":"x = 1 or 6"},{"id":"c","text":"x = -2 or -3"},{"id":"d","text":"x = 5 or 6"}]','a',
        'Factorises to (x−2)(x−3) = 0, so x = 2 or 3.',0.6),
      ('SSS1','PHY-MOTION-1','Which of these is a VECTOR quantity?',
        '[{"id":"a","text":"velocity"},{"id":"b","text":"speed"},{"id":"c","text":"distance"},{"id":"d","text":"mass"}]','a',
        'Velocity has both magnitude and direction — it is a vector.',0.55)
    ) AS t(class_code, obj_code, stem, options, correct, explanation, difficulty)
  LOOP
    INSERT INTO public.academy_question_items (type, stem, options, answer, difficulty, objective_id, subject_id, tags, status)
    SELECT 'mcq', q.stem, q.options::jsonb,
           jsonb_build_object('correct', jsonb_build_array(q.correct), 'explanation', q.explanation),
           q.difficulty, o.id, s.id, ARRAY['placement'], 'approved'
    FROM public.academy_learning_objectives o
    JOIN public.academy_topics t              ON t.id = o.topic_id
    JOIN public.academy_subjects s            ON s.id = t.subject_id
    JOIN public.academy_classes c             ON c.id = s.class_id
    JOIN public.academy_curriculum_versions v ON v.id = c.version_id AND v.code = 'NERDC-2025'
    WHERE o.code = q.obj_code AND c.code = q.class_code
      AND NOT EXISTS (
        SELECT 1 FROM public.academy_question_items x
        WHERE x.objective_id = o.id AND x.tags @> ARRAY['placement'] AND x.stem = q.stem
      );
  END LOOP;
END $$;
