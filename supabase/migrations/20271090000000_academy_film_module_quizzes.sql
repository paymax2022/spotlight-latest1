-- Module-level checkpoint quizzes for the Film Academy foundation curriculum.
-- Each module gets one objective quiz drawn from the approved question bank;
-- a learner needs 85% to unlock the next module (enforced in /api/academy/learning).
--
-- ADR-PR883-film-academy-module-quizzes
--
-- Additive and idempotent: modules are located by (program, order_index) rather
-- than hardcoded ids, exam ids are derived deterministically, and questions are
-- keyed on external_code so a re-run inserts nothing twice.

INSERT INTO public.academy_exams (
  id, program_id, module_id, title, description, kind, pass_mark,
  time_limit_minutes, max_attempts, is_published,
  draw_stage, draw_module_codes, draw_count
)
SELECT
  md5('film-module-quiz-' || m.order_index)::uuid,
  m.program_id,
  m.id,
  m.title || ' Quiz',
  'Objective questions on this module. Score 85% or more to unlock the next module.',
  'checkpoint',
  85,
  15,
  3,
  true,
  'L0',
  ARRAY['FM0' || (m.order_index + 1)::text],
  4
FROM public.academy_modules m
WHERE m.program_id = '1c4c286b-3cab-55ac-9c4b-acc6fe111688'::uuid
  AND m.order_index BETWEEN 0 AND 5
ON CONFLICT (id) DO NOTHING;

-- Approved question bank: 4 questions per module, codes FM01..FM06, stage L0.
INSERT INTO public.academy_question_items (
  type, stem, options, answer, status, academy_scope, film_stage,
  film_module_code, film_points, external_code
)
SELECT
  'mcq', q.stem,
  jsonb_build_array(
    jsonb_build_object('id', 'a', 'text', q.a),
    jsonb_build_object('id', 'b', 'text', q.b),
    jsonb_build_object('id', 'c', 'text', q.c),
    jsonb_build_object('id', 'd', 'text', q.d)
  ),
  jsonb_build_object('correct', jsonb_build_array(q.correct)),
  'approved', 'film', 'L0', q.module_code, 1, q.external_code
FROM (VALUES
  ('FM01','FM01-Q1','Which term describes a single continuous run of the camera?','A take','A scene','A sequence','A cut','a'),
  ('FM01','FM01-Q2','What does a wide shot mainly establish?','The setting and spatial context','A close emotional reaction','The film''s soundtrack','The credits order','a'),
  ('FM01','FM01-Q3','Which of these is a film genre?','Thriller','Close-up','Boom mic','Aspect ratio','a'),
  ('FM01','FM01-Q4','What is mise-en-scene?','Everything placed in front of the camera in a frame','The editing rhythm','The final colour grade','The sound mix','a'),
  ('FM02','FM02-Q1','In a screenplay, what does the logline do?','Summarises the story in one or two sentences','Lists the cast','Sets the shooting schedule','Describes the camera gear','a'),
  ('FM02','FM02-Q2','Which structure splits a story into setup, confrontation and resolution?','Three-act structure','Montage structure','Documentary structure','Shot-reverse-shot','a'),
  ('FM02','FM02-Q3','What is a protagonist?','The central character driving the story','The film''s director','The main antagonist','The narrator only','a'),
  ('FM02','FM02-Q4','What is the purpose of a scene heading (slug line)?','States interior/exterior, location and time of day','Lists the dialogue','Names the editor','Sets the film''s budget','a'),
  ('FM03','FM03-Q1','Which setting widens or narrows the lens opening?','Aperture','Frame rate','White balance','Shutter angle','a'),
  ('FM03','FM03-Q2','What does a shallow depth of field produce?','A sharp subject with a blurred background','Everything in focus','A darker image only','A faster frame rate','a'),
  ('FM03','FM03-Q3','The rule of thirds is a guide for what?','Composition','Sound levels','Editing speed','Budget planning','a'),
  ('FM03','FM03-Q4','A camera turning left or right on a fixed point is called a?','Pan','Dolly','Zoom','Tilt','a'),
  ('FM04','FM04-Q1','What does a key light do?','Provides the main illumination of the subject','Lights only the background','Creates the soundtrack','Controls the frame rate','a'),
  ('FM04','FM04-Q2','What is ambient sound?','Natural background sound of a location','Added music score','Voice-over narration','Dubbed dialogue','a'),
  ('FM04','FM04-Q3','Which microphone is commonly held above actors out of frame?','Boom mic','Lavalier mic','Studio condenser','Headset mic','a'),
  ('FM04','FM04-Q4','Warm (low colour temperature) light typically looks?','Orange or yellow','Blue','Green','Pure white','a'),
  ('FM05','FM05-Q1','What is blocking?','Planning actors'' positions and movement','Covering a lens','Colour correcting','Mixing audio','a'),
  ('FM05','FM05-Q2','What does a director say to begin recording?','Action','Cut','Wrap','Print','a'),
  ('FM05','FM05-Q3','Why run a table read?','To hear the script performed and spot problems','To grade the footage','To design posters','To book locations','a'),
  ('FM05','FM05-Q4','Coverage means filming a scene from?','Multiple angles and sizes','One angle only','Only wide shots','Only the actors'' backs','a'),
  ('FM06','FM06-Q1','What is a rough cut?','An early assembly of the edit','The final delivered film','The raw camera footage','The sound mix','a'),
  ('FM06','FM06-Q2','What is colour grading?','Adjusting colour and tone for a consistent look','Recording sound effects','Writing the script','Casting actors','a'),
  ('FM06','FM06-Q3','What does a J-cut do?','Audio from the next shot starts before its picture','Picture and audio cut together','Removes the audio','Reverses the clip','a'),
  ('FM06','FM06-Q4','Which stage comes last in post-production?','Final export and delivery','Raw ingest','Rough assembly','Script breakdown','a')
) AS q(module_code, external_code, stem, a, b, c, d, correct)
WHERE NOT EXISTS (
  SELECT 1 FROM public.academy_question_items i
  WHERE i.external_code = q.external_code AND i.academy_scope = 'film'
);
