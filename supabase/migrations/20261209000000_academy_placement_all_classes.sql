-- Curriculum content + placement questions for the remaining 8 classes
-- (P2, P3, P5, P6, JSS2, JSS3, SSS2, SSS3) — completes "all 12 classes" placement
-- coverage on top of 20261102000000 (the four entry classes).
--
-- Seeds, per class, three CORE subjects (English, Mathematics, a Science) each
-- with one topic → one objective, then one approved MCQ tied to that objective.
-- Exam relevance by phase: Upper Primary→CCE, JSS→BECE, SSS→WASSCE/NECO/UTME;
-- Lower Primary has no terminal exam.
--
-- Additive + idempotent: subject/topic/objective inserts use ON CONFLICT on their
-- natural UNIQUE keys; question inserts are guarded by NOT EXISTS on
-- (objective, 'placement' tag, stem). Safe to re-run.

-- ── 1) Curriculum content (subjects → topics → objectives) ───────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- class, subj_code, subj_name, exam_rel(text[]), topic_code, topic_title, obj_code, obj_title, obj_tags(text[])
      ('P2','ENG','English Studies','{}','ENG-RHYME','Vocabulary and Rhymes','ENG-RHYME-1','Identify rhyming words','{}'),
      ('P2','MTH','Mathematics','{}','MTH-ADD20','Addition within 20','MTH-ADD20-1','Add numbers within 20','{}'),
      ('P2','BSC','Basic Science and Technology','{}','BSC-ANIM','Animals Around Us','BSC-ANIM-1','Identify common animals','{}'),
      ('P3','ENG','English Studies','{}','ENG-PLUR','Nouns and Plurals','ENG-PLUR-1','Form plural nouns','{}'),
      ('P3','MTH','Mathematics','{}','MTH-MUL','Multiplication','MTH-MUL-1','Multiply single-digit numbers','{}'),
      ('P3','BSC','Basic Science and Technology','{}','BSC-ENV','Our Environment','BSC-ENV-1','Identify natural sources of light','{}'),
      ('P5','ENG','English Studies','{CCE}','ENG-POS','Parts of Speech','ENG-POS-1','Identify pronouns','{CCE}'),
      ('P5','MTH','Mathematics','{CCE}','MTH-FQ','Fractions of Quantities','MTH-FQ-1','Find a fraction of a quantity','{CCE}'),
      ('P5','BST','Basic Science and Technology','{CCE}','BST-CHG','Changes in Matter','BST-CHG-1','Describe changes of state','{CCE}'),
      ('P6','ENG','English Studies','{CCE}','ENG-TENSE','Verb Tenses','ENG-TENSE-1','Use the simple past tense','{CCE}'),
      ('P6','MTH','Mathematics','{CCE}','MTH-BODMAS','Order of Operations','MTH-BODMAS-1','Apply order of operations','{CCE}'),
      ('P6','BST','Basic Science and Technology','{CCE}','BST-PLANT','Plant Processes','BST-PLANT-1','Explain how plants make food','{CCE}'),
      ('JSS2','ENG','English Language','{BECE}','ENG-ADV','Adverbs','ENG-ADV-1','Identify adverbs','{BECE}'),
      ('JSS2','MTH','Mathematics','{BECE}','MTH-EQ','Simple Equations','MTH-EQ-1','Solve one-step equations','{BECE}'),
      ('JSS2','BSC','Basic Science','{BECE}','BSC-RESP','Respiration','BSC-RESP-1','State the gas needed for respiration','{BECE}'),
      ('JSS3','ENG','English Language','{BECE}','ENG-SENT','Sentence Structure','ENG-SENT-1','Recognise a complete sentence','{BECE}'),
      ('JSS3','MTH','Mathematics','{BECE}','MTH-EXP','Algebraic Expansion','MTH-EXP-1','Expand simple brackets','{BECE}'),
      ('JSS3','BSC','Basic Science','{BECE}','BSC-LIFE','The Cell','BSC-LIFE-1','Name the basic unit of life','{BECE}'),
      ('SSS2','ENG','English Language','{WASSCE,NECO,UTME}','ENG-VOCAB','Vocabulary Relations','ENG-VOCAB-1','Distinguish antonyms and synonyms','{WASSCE,UTME}'),
      ('SSS2','MTH','Mathematics','{WASSCE,NECO,UTME}','MTH-FUNC','Functions','MTH-FUNC-1','Evaluate a function','{WASSCE,UTME}'),
      ('SSS2','PHY','Physics','{WASSCE,NECO,UTME}','PHY-FORCE','Force and Units','PHY-FORCE-1','State the SI unit of force','{WASSCE,UTME}'),
      ('SSS3','ENG','English Language','{WASSCE,NECO,UTME}','ENG-REG','Register','ENG-REG-1','Identify formal register','{WASSCE,UTME}'),
      ('SSS3','MTH','Mathematics','{WASSCE,NECO,UTME}','MTH-DIFF','Differentiation','MTH-DIFF-1','Differentiate a power of x','{WASSCE,UTME}'),
      ('SSS3','PHY','Physics','{WASSCE,NECO,UTME}','PHY-GRAV','Gravity','PHY-GRAV-1','State g near the Earth surface','{WASSCE,UTME}')
    ) AS t(cls, subj_code, subj_name, exam_rel, topic_code, topic_title, obj_code, obj_title, obj_tags)
  LOOP
    INSERT INTO public.academy_subjects (version_id, class_id, code, name, kind, exam_relevance)
    SELECT v.id, c.id, r.subj_code, r.subj_name, 'core', r.exam_rel::text[]
    FROM public.academy_classes c
    JOIN public.academy_curriculum_versions v ON v.id = c.version_id AND v.code = 'NERDC-2025'
    WHERE c.code = r.cls
    ON CONFLICT (class_id, code) DO NOTHING;

    INSERT INTO public.academy_topics (subject_id, code, title, ordinal)
    SELECT s.id, r.topic_code, r.topic_title, 1
    FROM public.academy_subjects s
    JOIN public.academy_classes c ON c.id = s.class_id
    JOIN public.academy_curriculum_versions v ON v.id = c.version_id AND v.code = 'NERDC-2025'
    WHERE c.code = r.cls AND s.code = r.subj_code
    ON CONFLICT (subject_id, code) DO NOTHING;

    INSERT INTO public.academy_learning_objectives (topic_id, code, title, exam_tags, ordinal)
    SELECT t.id, r.obj_code, r.obj_title, r.obj_tags::text[], 1
    FROM public.academy_topics t
    JOIN public.academy_subjects s ON s.id = t.subject_id
    JOIN public.academy_classes c ON c.id = s.class_id
    JOIN public.academy_curriculum_versions v ON v.id = c.version_id AND v.code = 'NERDC-2025'
    WHERE c.code = r.cls AND s.code = r.subj_code AND t.code = r.topic_code
    ON CONFLICT (topic_id, code) DO NOTHING;
  END LOOP;
END $$;

-- ── 2) Placement questions tied to the objectives above ──────────────────────
DO $$
DECLARE q record;
BEGIN
  FOR q IN
    SELECT * FROM (VALUES
      ('P2','ENG-RHYME-1','Which word rhymes with "cat"?',
        '[{"id":"a","text":"hat"},{"id":"b","text":"dog"},{"id":"c","text":"sun"},{"id":"d","text":"pen"}]','a','"hat" ends with the same -at sound as "cat".',0.25),
      ('P2','MTH-ADD20-1','What is 7 + 5?',
        '[{"id":"a","text":"11"},{"id":"b","text":"12"},{"id":"c","text":"13"},{"id":"d","text":"10"}]','b','7 and 5 make 12.',0.25),
      ('P2','BSC-ANIM-1','Which animal can fly?',
        '[{"id":"a","text":"bird"},{"id":"b","text":"fish"},{"id":"c","text":"dog"},{"id":"d","text":"cow"}]','a','Birds have wings and can fly.',0.25),
      ('P3','ENG-PLUR-1','What is the plural of "book"?',
        '[{"id":"a","text":"books"},{"id":"b","text":"bookes"},{"id":"c","text":"book"},{"id":"d","text":"booki"}]','a','Add -s to make the plural: books.',0.3),
      ('P3','MTH-MUL-1','What is 6 × 3?',
        '[{"id":"a","text":"9"},{"id":"b","text":"18"},{"id":"c","text":"12"},{"id":"d","text":"21"}]','b','6 groups of 3 make 18.',0.3),
      ('P3','BSC-ENV-1','Which of these gives us light during the day?',
        '[{"id":"a","text":"the sun"},{"id":"b","text":"the moon"},{"id":"c","text":"a lamp"},{"id":"d","text":"a torch"}]','a','The sun is our natural source of daytime light.',0.3),
      ('P5','ENG-POS-1','Pick the pronoun: "She went home."',
        '[{"id":"a","text":"She"},{"id":"b","text":"went"},{"id":"c","text":"home"},{"id":"d","text":"."}]','a','"She" replaces a noun — it is a pronoun.',0.4),
      ('P5','MTH-FQ-1','What is 3/4 of 20?',
        '[{"id":"a","text":"15"},{"id":"b","text":"12"},{"id":"c","text":"16"},{"id":"d","text":"5"}]','a','20 ÷ 4 = 5, then × 3 = 15.',0.45),
      ('P5','BST-CHG-1','Water turns into ice when it is:',
        '[{"id":"a","text":"heated"},{"id":"b","text":"cooled"},{"id":"c","text":"stirred"},{"id":"d","text":"mixed"}]','b','Cooling water below 0°C freezes it into ice.',0.4),
      ('P6','ENG-TENSE-1','What is the past tense of "go"?',
        '[{"id":"a","text":"goed"},{"id":"b","text":"went"},{"id":"c","text":"gone"},{"id":"d","text":"going"}]','b','"go" is irregular; its past tense is "went".',0.45),
      ('P6','MTH-BODMAS-1','Work out: 12 ÷ 4 + 2',
        '[{"id":"a","text":"5"},{"id":"b","text":"2"},{"id":"c","text":"8"},{"id":"d","text":"6"}]','a','Divide first: 12÷4=3, then +2 = 5.',0.5),
      ('P6','BST-PLANT-1','Plants make their own food by a process called:',
        '[{"id":"a","text":"photosynthesis"},{"id":"b","text":"respiration"},{"id":"c","text":"digestion"},{"id":"d","text":"evaporation"}]','a','Green plants make food from light in photosynthesis.',0.5),
      ('JSS2','ENG-ADV-1','Identify the adverb: "He ran quickly."',
        '[{"id":"a","text":"He"},{"id":"b","text":"ran"},{"id":"c","text":"quickly"},{"id":"d","text":"."}]','c','"quickly" describes how he ran — it is an adverb.',0.5),
      ('JSS2','MTH-EQ-1','Solve for x:  2x = 10',
        '[{"id":"a","text":"5"},{"id":"b","text":"8"},{"id":"c","text":"20"},{"id":"d","text":"12"}]','a','Divide both sides by 2: x = 5.',0.5),
      ('JSS2','BSC-RESP-1','Which gas do humans breathe in to stay alive?',
        '[{"id":"a","text":"oxygen"},{"id":"b","text":"carbon dioxide"},{"id":"c","text":"nitrogen"},{"id":"d","text":"hydrogen"}]','a','We take in oxygen for respiration.',0.5),
      ('JSS3','ENG-SENT-1','Which of these is a COMPLETE sentence?',
        '[{"id":"a","text":"The dog barked."},{"id":"b","text":"Running fast."},{"id":"c","text":"In the garden."},{"id":"d","text":"Because he"}]','a','It has a subject and a verb and a full thought.',0.55),
      ('JSS3','MTH-EXP-1','Expand:  2(x + 3)',
        '[{"id":"a","text":"2x + 6"},{"id":"b","text":"2x + 3"},{"id":"c","text":"x + 6"},{"id":"d","text":"2x + 5"}]','a','Multiply 2 into the bracket: 2x + 6.',0.55),
      ('JSS3','BSC-LIFE-1','The basic unit of life is the:',
        '[{"id":"a","text":"cell"},{"id":"b","text":"atom"},{"id":"c","text":"tissue"},{"id":"d","text":"organ"}]','a','All living things are made of cells.',0.5),
      ('SSS2','ENG-VOCAB-1','A word OPPOSITE in meaning to another is a(n):',
        '[{"id":"a","text":"antonym"},{"id":"b","text":"synonym"},{"id":"c","text":"homonym"},{"id":"d","text":"pronoun"}]','a','Antonyms are opposite in meaning (hot/cold).',0.55),
      ('SSS2','MTH-FUNC-1','If f(x) = 2x + 1, find f(3).',
        '[{"id":"a","text":"7"},{"id":"b","text":"6"},{"id":"c","text":"5"},{"id":"d","text":"9"}]','a','f(3) = 2×3 + 1 = 7.',0.6),
      ('SSS2','PHY-FORCE-1','The SI unit of force is the:',
        '[{"id":"a","text":"newton"},{"id":"b","text":"joule"},{"id":"c","text":"watt"},{"id":"d","text":"pascal"}]','a','Force is measured in newtons (N).',0.55),
      ('SSS3','ENG-REG-1','Which opening is most appropriate for a FORMAL letter?',
        '[{"id":"a","text":"I am writing to apply for..."},{"id":"b","text":"Hey, what is up"},{"id":"c","text":"Gonna send this quick"},{"id":"d","text":"lol thanks"}]','a','Formal register avoids slang and contractions.',0.6),
      ('SSS3','MTH-DIFF-1','Differentiate y = x² with respect to x.',
        '[{"id":"a","text":"2x"},{"id":"b","text":"x"},{"id":"c","text":"x²"},{"id":"d","text":"2"}]','a','d/dx(xⁿ) = n·xⁿ⁻¹, so d/dx(x²) = 2x.',0.65),
      ('SSS3','PHY-GRAV-1','Acceleration due to gravity near the Earth is about:',
        '[{"id":"a","text":"9.8 m/s²"},{"id":"b","text":"1.0 m/s²"},{"id":"c","text":"98 m/s²"},{"id":"d","text":"0.98 m/s²"}]','a','g ≈ 9.8 m/s² at the Earth surface.',0.6)
    ) AS t(cls, obj_code, stem, options, correct, explanation, difficulty)
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
    WHERE o.code = q.obj_code AND c.code = q.cls
      AND NOT EXISTS (
        SELECT 1 FROM public.academy_question_items x
        WHERE x.objective_id = o.id AND x.tags @> ARRAY['placement'] AND x.stem = q.stem
      );
  END LOOP;
END $$;
