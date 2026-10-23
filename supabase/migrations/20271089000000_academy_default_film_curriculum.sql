-- ADR-PR882-film-academy-default-curriculum
-- Default film-academy curriculum, served to any enrolment whose batch has no
-- program attached (see ensureEnrollment default-program fallback). Additive &
-- idempotent: adds academy_programs.is_default, seeds one published default
-- program + modules + lessons with fixed UUIDs (ON CONFLICT DO NOTHING).
-- Self-contained per the academy seed gotcha: depends on no prior spine content.

ALTER TABLE public.academy_programs ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
-- At most one default program may exist.
CREATE UNIQUE INDEX IF NOT EXISTS academy_programs_one_default ON public.academy_programs (is_default) WHERE is_default;

INSERT INTO public.academy_programs (id, title, slug, description, batch_id, is_published, is_default, estimated_duration_weeks)
VALUES ('1c4c286b-3cab-55ac-9c4b-acc6fe111688', 'Film Academy — Foundation Curriculum', 'film-academy-foundation-default',
        'A starter filmmaking track covering story, camera, light, sound, directing and editing. Served by default to every enrolled learner.',
        NULL, true, true, 12)
ON CONFLICT (slug) DO UPDATE SET is_default = true, is_published = true;

INSERT INTO public.academy_modules (id, program_id, title, description, order_index, is_published)
VALUES ('1f35de4c-a95e-5c4e-8baf-778cc8ba5bba', '1c4c286b-3cab-55ac-9c4b-acc6fe111688', 'Orientation & the Language of Film', 'How cinema communicates, and how this programme works.', 0, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('d754eb8c-fd9d-52f5-9310-af91c1882ce6', '1f35de4c-a95e-5c4e-8baf-778cc8ba5bba', 'Welcome to the Academy', 'What you''ll learn, how lessons and assignments work, and how to get help.', '## Welcome

This foundation track takes you from the basics of visual storytelling to planning, shooting, and editing a short piece.

- How the course is structured (modules → lessons → assignments)
- What you need (a phone camera is enough to start)
- How grading and the practical showcase work', 0, 15, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('b60e1e13-c16c-56fe-a11f-8e4fe49dc12c', '1f35de4c-a95e-5c4e-8baf-778cc8ba5bba', 'How a Film Speaks', 'Shot, scene, sequence — the building blocks of visual storytelling.', '## The building blocks

- **Shot**: one continuous run of the camera
- **Scene**: action in one place and time
- **Sequence**: scenes that form a story beat

Watch any short film and try to name each cut.', 1, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('68dfc4b7-02e5-503f-ba85-7463d8b3da7c', '1f35de4c-a95e-5c4e-8baf-778cc8ba5bba', 'Shot Sizes & Angles', 'Wide, medium, close-up — and what each one makes the viewer feel.', '## Framing

- Wide (establish), Medium (relationship), Close-up (emotion)
- Eye-level vs high/low angle and the feeling each gives

**Try it:** shoot the same moment three ways.', 2, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('f5132538-3e5c-5a6d-9b61-889009b2e5a9', '1f35de4c-a95e-5c4e-8baf-778cc8ba5bba', 'Your Filmmaking Toolkit', 'Working with what you have: phone, light, and sound on a budget.', '## Start with what you have

- Stabilise your phone, lock exposure/focus
- Shoot near a window for soft light
- Record sound close to the subject', 3, 15, false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.academy_modules (id, program_id, title, description, order_index, is_published)
VALUES ('7669885b-0c85-5485-bb89-233b90fd3281', '1c4c286b-3cab-55ac-9c4b-acc6fe111688', 'Story, Script & Structure', 'Turning an idea into a script you can shoot.', 1, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('321101c3-ef84-5380-bd61-01b723f108a7', '7669885b-0c85-5485-bb89-233b90fd3281', 'Finding Your Story', 'Idea, theme, and the one thing your film is about.', '## From idea to premise

- Theme vs plot
- The logline: *When ___, a ___ must ___ or else ___*
- Keep your first film small and personal', 0, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('a531bdc0-507f-5825-b19b-2be9002afcb8', '7669885b-0c85-5485-bb89-233b90fd3281', 'Three-Act Structure', 'Setup, confrontation, resolution — the shape most stories share.', '## The three acts

1. **Setup** — who, where, what they want
2. **Confrontation** — obstacles escalate
3. **Resolution** — the change

Map a film you love onto these.', 1, 25, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('84f61af2-c169-5662-8ee6-6ce46999cc9e', '7669885b-0c85-5485-bb89-233b90fd3281', 'Writing a Scene', 'Action lines and dialogue that read clean on the page.', '## Scene craft

- Sluglines (INT./EXT. — LOCATION — TIME)
- Write what we **see and hear**, not what characters think
- Read dialogue out loud', 2, 25, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('334a3bc6-52c0-5bbf-a944-9b8bad2d1450', '7669885b-0c85-5485-bb89-233b90fd3281', 'The Shooting Script & Shot List', 'Breaking a scene into the shots you''ll actually capture.', '## Plan the shoot

- Turn each scene into a numbered shot list
- Note size, angle, and movement per shot
- A shot list is your insurance against a wasted shoot day', 3, 20, true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.academy_modules (id, program_id, title, description, order_index, is_published)
VALUES ('798eb001-665e-59aa-b5c7-149769adeb7f', '1c4c286b-3cab-55ac-9c4b-acc6fe111688', 'Camera & Cinematography Basics', 'Exposure, focus, and movement that serve the story.', 2, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('5b80a6f7-50c7-54be-b2e6-939050a4bc78', '798eb001-665e-59aa-b5c7-149769adeb7f', 'Exposure: ISO, Shutter, Aperture', 'The exposure triangle and the 180° shutter rule.', '## Exposure triangle

- **ISO** (sensitivity), **Shutter** (motion blur), **Aperture** (depth)
- Video rule of thumb: shutter ≈ 2× frame rate (180°)
- Expose for the face', 0, 25, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('4f4d80d3-7630-54b5-b4a1-da090302e4ff', '798eb001-665e-59aa-b5c7-149769adeb7f', 'Focus & Depth of Field', 'Pulling focus and using shallow depth with intent.', '## Depth

- Shallow isolates the subject; deep keeps context
- Watch for soft focus on movement
- Mark your focus distances', 1, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('793ffca0-a10c-538b-afa0-3c4cca123165', '798eb001-665e-59aa-b5c7-149769adeb7f', 'Composition & the Frame', 'Rule of thirds, headroom, lead room, and when to break them.', '## Composition

- Thirds, balance, leading lines
- Headroom and lead/nose room
- Break the rules **on purpose**', 2, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('63c8ecc8-1ea2-54ea-aefe-d00586fe3183', '798eb001-665e-59aa-b5c7-149769adeb7f', 'Camera Movement', 'Pan, tilt, push, and handheld — motivated motion.', '## Movement

- Every move should have a reason
- Lock it off when the moment is still
- Handheld = energy; tripod = control', 3, 20, false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.academy_modules (id, program_id, title, description, order_index, is_published)
VALUES ('9bbc2725-ac98-59fe-a3c5-3050cf5c4958', '1c4c286b-3cab-55ac-9c4b-acc6fe111688', 'Lighting & Sound Fundamentals', 'Making images readable and audio clean.', 3, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('a5b402bd-6bda-58c1-b4a4-33b05fb16f9f', '9bbc2725-ac98-59fe-a3c5-3050cf5c4958', 'Three-Point Lighting', 'Key, fill, and back light — and natural-light setups.', '## Three-point

- **Key** (main), **Fill** (soften shadows), **Back** (separation)
- One window + one bounce card gets you far
- Control contrast with distance', 0, 25, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('0d406566-d0af-5846-96e7-6b3d389d6743', '9bbc2725-ac98-59fe-a3c5-3050cf5c4958', 'Shaping & Colour', 'Soft vs hard light, and white balance that looks right.', '## Shaping light

- Bigger/closer source = softer
- Set white balance to your key light
- Mixed colour temperatures fight each other', 1, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('4714541a-d57f-58fd-86f4-c20850128973', '9bbc2725-ac98-59fe-a3c5-3050cf5c4958', 'Recording Clean Dialogue', 'Mic placement, levels, and room tone.', '## Clean audio

- Get the mic close (just out of frame)
- Aim for healthy levels, avoid clipping
- Record 30s of **room tone** every location', 2, 25, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('71841888-8a3a-5da1-8b4d-db8fee9af425', '9bbc2725-ac98-59fe-a3c5-3050cf5c4958', 'Location Sound Problems', 'Wind, echo, and background noise — and how to beat them.', '## Common problems

- Wind → foam/dead-cat, shelter the mic
- Echo → soft furnishings, get closer
- Scout for noise before you roll', 3, 15, false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.academy_modules (id, program_id, title, description, order_index, is_published)
VALUES ('1898538d-9882-5e17-9626-7b8505c5352f', '1c4c286b-3cab-55ac-9c4b-acc6fe111688', 'Directing & Working with Actors', 'Leading a set and getting honest performances.', 4, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('078fd869-f317-502e-8e55-02aec95e1ced', '1898538d-9882-5e17-9626-7b8505c5352f', 'The Director''s Job', 'Vision, communication, and running the floor.', '## What a director does

- Holds the vision and the tone
- Communicates it to cast and crew
- Protects the schedule and the performance', 0, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('ea220c27-fcd9-530f-a000-4d928081df35', '1898538d-9882-5e17-9626-7b8505c5352f', 'Blocking a Scene', 'Where people move and where the camera sits.', '## Blocking

- Stage the action first, then find the camera
- Blocking reveals relationship and power
- Rehearse the move before you light it', 1, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('d2c4de03-4e70-59c5-987e-5ed6fc850092', '1898538d-9882-5e17-9626-7b8505c5352f', 'Directing Actors', 'Actionable direction, and building trust on set.', '## Directing performance

- Give **active** directions (verbs), not results
- Create safety; one note at a time
- Know when you''ve got the take', 2, 25, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('9f098be5-ec27-5753-9e22-76787af6446c', '1898538d-9882-5e17-9626-7b8505c5352f', 'Run of the Day', 'Call sheets, schedule, and set etiquette.', '## On the day

- A simple call sheet keeps everyone aligned
- Shoot out of order to save setups
- Respect time, people, and locations', 3, 15, false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.academy_modules (id, program_id, title, description, order_index, is_published)
VALUES ('93d7b3d8-1238-57df-a229-3d692589338a', '1c4c286b-3cab-55ac-9c4b-acc6fe111688', 'Editing, Post & Your First Showcase', 'Assembling the cut and finishing your piece.', 5, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('3334d0a9-04af-5726-a055-a7eef58d66eb', '93d7b3d8-1238-57df-a229-3d692589338a', 'The Assembly Edit', 'Selects, the rough cut, and finding the story in post.', '## First cut

- Watch all footage, mark selects
- Build the rough cut long, then tighten
- The edit is the final rewrite', 0, 25, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('7da3add6-cbd6-5ddc-8cc7-98c98a303565', '93d7b3d8-1238-57df-a229-3d692589338a', 'Editing for Rhythm', 'Cut points, pacing, and continuity.', '## Rhythm

- Cut on motion and on meaning
- Match eyelines and screen direction
- Pace serves emotion, not speed', 1, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('3cffbd23-dea1-55b7-b0ff-c41cdb0b806b', '93d7b3d8-1238-57df-a229-3d692589338a', 'Sound, Music & Colour', 'A clean mix, music choices, and a simple grade.', '## Finishing

- Balance dialogue, effects, music
- Music sets tone — use it sparingly
- A gentle, consistent colour grade', 2, 20, true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.academy_lessons (id, module_id, title, description, content_markdown, order_index, estimated_minutes, is_required, is_published)
VALUES ('be1d519d-a2f8-5272-9abf-d27e164e4755', '93d7b3d8-1238-57df-a229-3d692589338a', 'Export & Showcase', 'Delivering your film and preparing for the practical.', '## Deliver

- Export at the right resolution/bitrate
- Title and credit your work
- Prepare to present it at the practical showcase', 3, 20, false, true)
ON CONFLICT (id) DO NOTHING;

