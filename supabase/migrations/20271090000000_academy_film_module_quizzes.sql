-- Add module-level quizzes for Film Academy default curriculum.
-- Each module has a quiz that must be passed at 85% to unlock the next module.
--
-- ADR-PR883-film-academy-module-quizzes

-- Insert quizzes linked to each module (idempotent via id)
INSERT INTO public.academy_exams (
  id, program_id, module_id, title, description, kind, pass_mark,
  time_limit_minutes, max_attempts, is_published, created_at
) VALUES
  -- Module 1: Film Fundamentals
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111689'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111688'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111690'::uuid,
    'Film Fundamentals Quiz',
    'Test your understanding of cinema history, shot types, and basic film language.',
    'module_quiz',
    85,
    15,
    3,
    true,
    now()
  ),
  -- Module 2: Cinematography Basics
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111691'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111688'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111692'::uuid,
    'Cinematography Basics Quiz',
    'Test your knowledge of lighting, composition, and camera movement.',
    'module_quiz',
    85,
    15,
    3,
    true,
    now()
  ),
  -- Module 3: Directing Techniques
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111693'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111688'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111694'::uuid,
    'Directing Techniques Quiz',
    'Test your understanding of directing methodology, actor direction, and visual storytelling.',
    'module_quiz',
    85,
    15,
    3,
    true,
    now()
  ),
  -- Module 4: Sound Design Essentials
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111695'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111688'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111696'::uuid,
    'Sound Design Essentials Quiz',
    'Test your knowledge of audio production, mixing, and soundscape creation.',
    'module_quiz',
    85,
    15,
    3,
    true,
    now()
  ),
  -- Module 5: Post-Production Workflow
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111697'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111688'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111698'::uuid,
    'Post-Production Workflow Quiz',
    'Test your understanding of editing, color grading, and final delivery.',
    'module_quiz',
    85,
    15,
    3,
    true,
    now()
  ),
  -- Module 6: Project Development
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111699'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111688'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111700'::uuid,
    'Project Development Quiz',
    'Test your ability to develop a complete film project from concept to completion.',
    'module_quiz',
    85,
    20,
    2,
    true,
    now()
  )
ON CONFLICT (id) DO NOTHING;

-- Create sample question bank for Module 1 quiz (4 questions)
INSERT INTO public.academy_question_banks (id, exam_id, question_text, question_type, created_at) VALUES
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111701'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111689'::uuid,
    'What is a shot in film terminology?',
    'multiple_choice',
    now()
  ),
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111702'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111689'::uuid,
    'Which of these is a common film genre?',
    'multiple_choice',
    now()
  ),
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111703'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111689'::uuid,
    'What is the purpose of a storyboard?',
    'multiple_choice',
    now()
  ),
  (
    '1c4c286b-3cab-55ac-9c4b-acc6fe111704'::uuid,
    '1c4c286b-3cab-55ac-9c4b-acc6fe111689'::uuid,
    'Define mise-en-scène in film.',
    'multiple_choice',
    now()
  )
ON CONFLICT (id) DO NOTHING;
