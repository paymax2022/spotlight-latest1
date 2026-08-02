-- Seed a starter set of LIVE lessons into public.academy_edu_lessons.
--
-- The curriculum tree (versions → classes → subjects → topics → objectives) is
-- seeded, but academy_edu_lessons was empty, so the learner lesson surface
-- (content.ListLiveLessonsForObjective / the curriculum topic→lessons bridge)
-- returned nothing. This attaches a few real lessons to existing NERDC-2025
-- objectives so the lesson endpoints serve live content.
--
-- Idempotent: objective_id/version_id are resolved by natural key (class/topic/
-- objective code) so the ids match whatever gen_random_uuid produced, and each
-- row is guarded by NOT EXISTS (objective_id, title) — re-running inserts nothing.
-- Additive-only; no existing rows touched.
INSERT INTO public.academy_edu_lessons
  (objective_id, title, type, version_id, media_ref, transcript, duration_s, status)
SELECT o.id, x.title, x.ltype, v.id, x.media_ref, x.transcript, x.duration_s, 'live'
FROM (VALUES
  ('JSS1','BSC-CELL','BSC-CELL-1','Plant and animal cells','video',
   'academy/jss1/bsc/cell-intro.mp4',
   'A cell is the basic unit of life. Plant cells have a rigid cell wall, chloroplasts for photosynthesis and a large central vacuole; animal cells have none of these. Both share a nucleus, cytoplasm and a cell membrane.',420),
  ('JSS1','MTH-INT','MTH-INT-1','Operations on integers','video',
   'academy/jss1/mth/integers.mp4',
   'Integers are the positive whole numbers, their negatives and zero. On the number line, adding a positive moves right and adding a negative moves left; subtracting a number is adding its opposite.',360),
  ('JSS1','MTH-INT','MTH-INT-2','Solving simple linear equations','interactive',
   'academy/jss1/mth/linear-eq.json',
   'To solve x + 5 = 12, undo the +5 by subtracting 5 from both sides, giving x = 7. Keep the equation balanced by doing the same operation on both sides.',300),
  ('JSS1','ENG-ESSAY','ENG-ESSAY-1','Writing a narrative essay','video',
   'academy/jss1/eng/narrative.mp4',
   'A narrative essay tells a story with a clear beginning, middle and end. Use the first person, past tense and vivid detail so the reader can picture each scene.',390),
  ('JSS1','ENG-ESSAY','ENG-ESSAY-2','Paragraphing and topic sentences','reading',
   'academy/jss1/eng/paragraphing.md',
   'Each paragraph carries one main idea, introduced by a topic sentence and developed by supporting sentences. Start a new paragraph when the idea, time or speaker changes.',240),
  ('P1','BSC-LIVING','BSC-LIVING-1','Living and non-living things','video',
   'academy/p1/bsc/living.mp4',
   'Living things grow, feed, breathe, move and reproduce; non-living things such as a stone or a chair do not. Sorting objects into living and non-living helps us make sense of the world.',240),
  ('P1','BSC-LIVING','BSC-LIVING-2','Parts of the body','interactive',
   'academy/p1/bsc/body-parts.json',
   'Point to your head, shoulders, knees and toes. Each part has a job: eyes to see, ears to hear, legs to walk. Naming body parts builds early science vocabulary.',210)
) AS x(class_code, topic_code, obj_code, title, ltype, media_ref, transcript, duration_s)
JOIN public.academy_curriculum_versions v ON v.code = 'NERDC-2025'
JOIN public.academy_classes c  ON c.version_id = v.id AND c.code = x.class_code
JOIN public.academy_subjects s ON s.class_id = c.id
JOIN public.academy_topics t   ON t.subject_id = s.id AND t.code = x.topic_code
JOIN public.academy_learning_objectives o ON o.topic_id = t.id AND o.code = x.obj_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.academy_edu_lessons el
  WHERE el.objective_id = o.id AND el.title = x.title
);
