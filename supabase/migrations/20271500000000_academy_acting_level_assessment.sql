-- ── Film Academy: the Acting Class level assessments (Beginner / Intermediate / Advanced)
--
-- WHAT THIS IS. The instructor's objective test paper for the Acting course:
-- three levels, 20 single-select questions each, 1 mark per question, 17/20 to
-- pass. Source, delivered 2026-11-16: spotlight_acting_quiz_bank.json (the bank),
-- spotlight_acting_student_quiz.md (the paper) and spotlight_acting_instructor_key.md
-- (the key and the per-question rationale). The two .md files stay outside the
-- repo, in the same place as the other PRD artifacts; the bank is committed here
-- because that is where this plane keeps its answer keys — see
-- 20271400000200_academy_tmfa_curriculum.sql and the 256-row CSV under
-- frontend-web/tests/fixtures/academy/.
--
-- THIS IS THE DEFAULT ACTING QUIZ, AND IT IS LIVE ON APPLY. Every other bank in
-- this table arrives as 'draft' and waits for SME review, because the doctrine is
-- that importing must never make a question exam-eligible on its own. This one is
-- seeded 'approved' with is_published = true at the product owner's explicit
-- direction on 2026-11-16 ("this should be the default quiz for acting students"),
-- on the basis that the paper is final instructor-authored work delivered WITH its
-- answer key rather than a draft awaiting review. That is a human decision about
-- this content, not a change to the pipeline: the seed still writes nothing to the
-- learner surface, and the invariants that are NOT publication policy all still
-- hold — academy_question_items.answer stays the only place correctness exists,
-- learner DTOs still carry opaque presentationOptionIds and never the key or the
-- rationale (assessment/types.ts:7), and grading stays server-side.
--
-- WHY EACH EXAM MUST PIN ITS MODULE CODE. bank.ts applies the module filter only
-- when draw_module_codes is non-empty (poolCount :223, drawApproved :265). An exam
-- carrying just draw_stage = 'L1' therefore draws from EVERY approved L1 film
-- question in the database — the whole academy, not the Acting paper. So each
-- level owns a code no other content uses ('ACT-B' / 'ACT-I' / 'ACT-A'), which
-- makes its pool exactly its own 20 questions and keeps it that way after future
-- imports. film_stage still carries the real stage (Beginner→L1, Intermediate→L2,
-- Advanced→L3), so the (academy_scope, film_stage, status) draw index and every
-- stage-scoped admin filter keep working.
--
-- WHY 85 IS EXACTLY 17 OF 20. moduleGate.meetsPassMark compares on whole points
-- (earned * 100 >= possible * pass_mark), never on the stored NUMERIC(5,2)
-- percentage, so 17/20 passes and 16/20 fails with no rounding room. The 20 items
-- are drawn without replacement from a pool of 20, so a retake is the same paper
-- in a new order with the options shuffled per item — which is the "retake a
-- shuffled assessment" instruction in the key's remediation note.
--
-- WHICH PROGRAMMES. listLearnerExams shows a learner only the published exams on
-- their own programme, and academy/index.ts:ensureEnrollment resolves that
-- programme from academy_programs.batch_id, falling back to the is_default row
-- when no programme names the batch — which is every batch today, so every
-- enrolled acting student is on the default curriculum. The tmfa-professional-
-- filmmaker-pathway programme also has an Acting course (A01–A24) but is
-- unpublished, so exams seated there would start for nobody; it is deliberately
-- not targeted here. screen-acting-foundations-2026 IS published and IS the
-- acting-titled programme, so it gets the same three exams and is already served
-- the moment a batch points at it.
--
-- Additive and idempotent: data only, no DDL. Question rows are keyed on
-- external_code (partial unique index, academy_scope='film') with WHERE NOT
-- EXISTS, exactly like 20271090000000_academy_film_module_quizzes.sql; exam ids
-- are md5-derived per (programme, level) under ON CONFLICT DO NOTHING, so a re-run
-- inserts nothing and never overwrites an admin's later edit. No UPDATE, no
-- DELETE, no TRUNCATE, no rename, no type change.
--
-- NOTE FOR THE TEST THAT READS THIS FILE. 'delete' appears inside a distractor
-- (ACT-B-011, "Ask the camera operator to delete the take"), so
-- acting-level-assessment.test.ts anchors its additive-only assertion to the start
-- of a line rather than searching the whole text.

-- ─── 1. The 60 questions, into the shared film academy bank ─────────────────
INSERT INTO public.academy_question_items (
  type, stem, options, answer, status, academy_scope, film_stage,
  film_module_code, film_department, film_learning_outcome, film_difficulty,
  film_keywords, film_points, external_code
)
SELECT
  'mcq',
  q.question,
  jsonb_build_array(
    jsonb_build_object('id', 'a', 'text', q.a),
    jsonb_build_object('id', 'b', 'text', q.b),
    jsonb_build_object('id', 'c', 'text', q.c),
    jsonb_build_object('id', 'd', 'text', q.d)
  ),
  jsonb_build_object('correct', jsonb_build_array(q.correct), 'explanation', q.rationale),
  'approved', 'film', q.stage, q.module_code,
  'Acting for Camera', q.category, q.level,
  ARRAY[q.category], q.points, q.code
FROM jsonb_to_recordset($acting$
[
  {"code": "ACT-B-001", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Acting foundations", "question": "What is the main responsibility of an actor in a scripted scene?", "a": "To attract more attention than other actors", "b": "To change the script whenever possible", "c": "To deliver every line as loudly as possible", "d": "To portray a character truthfully within the story", "correct": "d", "rationale": "Acting aims to communicate the character’s truthful behavior and the story.", "points": 1},
  {"code": "ACT-B-002", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Script literacy", "question": "In a screenplay, what does INT. usually indicate?", "a": "An invisible character", "b": "An interview scene", "c": "An interrupted action", "d": "An interior location", "correct": "d", "rationale": "INT. is the standard abbreviation for an interior scene.", "points": 1},
  {"code": "ACT-B-003", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Script literacy", "question": "What does EXT. mean in a screenplay scene heading?", "a": "Extra actor needed", "b": "Extended dialogue", "c": "An exterior location", "d": "Extreme close-up", "correct": "c", "rationale": "EXT. identifies an exterior location.", "points": 1},
  {"code": "ACT-B-004", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Character understanding", "question": "What is a character’s objective?", "a": "The costume assigned by wardrobe", "b": "The number of lines in the scene", "c": "The emotion the audience must feel", "d": "What the character wants to achieve", "correct": "d", "rationale": "An objective describes what a character seeks to achieve.", "points": 1},
  {"code": "ACT-B-005", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Preparation", "question": "Which activity best prepares an actor for a first rehearsal?", "a": "Avoiding questions for the director", "b": "Memorising only their own lines without context", "c": "Reading the whole script and understanding the scene", "d": "Choosing a different ending for the story", "correct": "c", "rationale": "Reading the script in context helps actors understand circumstances and relationships.", "points": 1},
  {"code": "ACT-B-006", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Listening", "question": "When another actor is speaking, what should you normally do?", "a": "Look away until it is your turn", "b": "Listen and respond as your character would", "c": "Prepare your next line without paying attention", "d": "Repeat their words to fill the silence", "correct": "b", "rationale": "Active listening creates credible reactions and timing.", "points": 1},
  {"code": "ACT-B-007", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Blocking", "question": "What does blocking refer to?", "a": "Planned movements and positions in a scene", "b": "Stopping a scene from being filmed", "c": "Removing unwanted lines from a script", "d": "Covering an actor’s face with a prop", "correct": "a", "rationale": "Blocking maps the actors’ physical positions and movement.", "points": 1},
  {"code": "ACT-B-008", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Camera awareness", "question": "What is an actor’s mark on a film set?", "a": "A special effect added in editing", "b": "The designated position where an actor should stand", "c": "A note about the actor’s exam score", "d": "A place where the camera is stored", "correct": "b", "rationale": "Marks help actors maintain framing, focus and continuity.", "points": 1},
  {"code": "ACT-B-009", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Voice", "question": "Why is clear diction useful for screen acting?", "a": "It makes every character sound formal", "b": "It means every line must be shouted", "c": "It helps the audience understand spoken words", "d": "It eliminates the need for emotional expression", "correct": "c", "rationale": "Clear diction improves intelligibility without requiring unnatural speech.", "points": 1},
  {"code": "ACT-B-010", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Voice", "question": "Which breathing habit best supports controlled dialogue delivery?", "a": "Shallow, fast breathing at all times", "b": "Relaxed, supported breathing", "c": "Forcing every word from your throat", "d": "Holding your breath for a whole speech", "correct": "b", "rationale": "Relaxed, supported breathing assists vocal control.", "points": 1},
  {"code": "ACT-B-011", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "On-set etiquette", "question": "What should an actor do when the director calls “Cut”?", "a": "Ask the camera operator to delete the take", "b": "Stop the performance and await instructions", "c": "Continue acting until the next scene begins", "d": "Leave set immediately without permission", "correct": "b", "rationale": "“Cut” ends the take; actors should follow the crew’s next instruction.", "points": 1},
  {"code": "ACT-B-012", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Wardrobe and continuity", "question": "Why should an actor keep the same costume details across matching takes?", "a": "To avoid memorising new dialogue", "b": "To change the scene’s location", "c": "To make the sound louder", "d": "To protect visual continuity between shots", "correct": "d", "rationale": "Matching details allow editors to join shots without visible inconsistencies.", "points": 1},
  {"code": "ACT-B-013", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Emotional expression", "question": "What generally makes a screen reaction believable?", "a": "Reacting to the situation and scene partner", "b": "Showing the biggest possible facial expression", "c": "Delaying every response by five seconds", "d": "Looking into the lens for every reaction", "correct": "a", "rationale": "Believable reactions come from attention to the fictional situation.", "points": 1},
  {"code": "ACT-B-014", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Collaboration", "question": "Who normally guides the creative interpretation of a filmed scene?", "a": "The film director", "b": "The catering team", "c": "The location security officer", "d": "The ticket seller", "correct": "a", "rationale": "The director normally leads the scene’s overall creative interpretation.", "points": 1},
  {"code": "ACT-B-015", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Character relationships", "question": "Why should an actor know how their character relates to another character?", "a": "To decide who gets more screen time", "b": "To establish behavior, stakes and emotional context", "c": "To avoid rehearsing with the other actor", "d": "To replace the other character’s dialogue", "correct": "b", "rationale": "Relationships affect how characters speak, react and pursue goals.", "points": 1},
  {"code": "ACT-B-016", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Film terminology", "question": "What is a close-up commonly used to emphasize?", "a": "A character’s face or important detail", "b": "A wide view of the entire neighborhood", "c": "The lighting crew behind camera", "d": "Every person in a large crowd", "correct": "a", "rationale": "Close-ups commonly highlight a face or significant detail.", "points": 1},
  {"code": "ACT-B-017", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Script literacy", "question": "In a screenplay, dialogue is primarily written to show:", "a": "What music the editor must use", "b": "The shooting budget", "c": "What a character says", "d": "The final camera lens specification", "correct": "c", "rationale": "Dialogue communicates a character’s spoken words.", "points": 1},
  {"code": "ACT-B-018", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Improvisation", "question": "What does improvisation mean in acting?", "a": "Acting spontaneously within a situation", "b": "Speaking with no connection to a character", "c": "Refusing to follow all direction", "d": "Changing the production schedule", "correct": "a", "rationale": "Improvisation involves spontaneous performance guided by the scene’s circumstances.", "points": 1},
  {"code": "ACT-B-019", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Set professionalism", "question": "If an actor does not understand an instruction, what is the best response?", "a": "Argue loudly during a take", "b": "Pretend to understand and guess", "c": "Ignore the instruction permanently", "d": "Ask a clear, respectful question at the appropriate time", "correct": "d", "rationale": "Constructive clarification supports both safety and performance.", "points": 1},
  {"code": "ACT-B-020", "level": "Beginner", "stage": "L1", "module_code": "ACT-B", "category": "Safety", "question": "Before performing a fall or physical confrontation, an actor should:", "a": "Attempt it at full speed without rehearsal", "b": "Let another actor surprise them", "c": "Ask for approved choreography and safety guidance", "d": "Choose the hardest surface for realism", "correct": "c", "rationale": "Physical action must be planned with qualified supervision and consent.", "points": 1},
  {"code": "ACT-I-001", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Objectives and tactics", "question": "A character wants a friend to reveal a secret. Which is the most playable objective?", "a": "To feel suspicious", "b": "To create a dramatic atmosphere", "c": "To make the friend tell the truth", "d": "To act mysteriously", "correct": "c", "rationale": "“Make the friend tell the truth” is an actionable goal.", "points": 1},
  {"code": "ACT-I-002", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Subtext", "question": "A character says “I am fine” while hiding disappointment. The hidden meaning is called:", "a": "Subtext", "b": "Blocking", "c": "A slate", "d": "Exposure", "correct": "a", "rationale": "Subtext is the unspoken intention or feeling beneath the dialogue.", "points": 1},
  {"code": "ACT-I-003", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Stakes", "question": "What are the stakes in a scene?", "a": "Where the boom microphone is placed", "b": "The number of camera takes available", "c": "What may be gained or lost by the character", "d": "The cost of hiring a location", "correct": "c", "rationale": "Stakes describe meaningful consequences of success or failure.", "points": 1},
  {"code": "ACT-I-004", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Continuity", "question": "In a master shot, an actor picks up a glass with the right hand. During the matching close-up, the best practice is to:", "a": "Use the left hand to create variety", "b": "Pick up two glasses instead", "c": "Ignore the prop completely", "d": "Repeat the action with the right hand at the same moment", "correct": "d", "rationale": "Repeatable action gives editors consistent coverage.", "points": 1},
  {"code": "ACT-I-005", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Scene analysis", "question": "A beat change most often occurs when:", "a": "The scene changes costume", "b": "The performer finishes counting ten seconds", "c": "The camera battery is replaced", "d": "An intention, tactic or situation shifts", "correct": "d", "rationale": "Beats track meaningful changes in dramatic action.", "points": 1},
  {"code": "ACT-I-006", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Listening and reacting", "question": "Your scene partner unexpectedly pauses before revealing bad news. The strongest response is to:", "a": "Look at the director for approval", "b": "Stay in character, listen and respond truthfully", "c": "Invent unrelated dialogue", "d": "Recite your cue regardless of the pause", "correct": "b", "rationale": "Responsive acting prioritizes the partner and the evolving moment.", "points": 1},
  {"code": "ACT-I-007", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Camera eyelines", "question": "During a close-up, the director places your scene partner just beside the camera. Where should you normally look?", "a": "At the playback monitor", "b": "Directly into the lens regardless of instruction", "c": "At the floor for the whole scene", "d": "At the agreed off-camera eyeline", "correct": "d", "rationale": "A consistent eyeline helps preserve spatial relationships in edited scenes.", "points": 1},
  {"code": "ACT-I-008", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Vocal performance", "question": "For an intimate conversation filmed in close-up, the most effective vocal choice is generally:", "a": "Speak with no audible consonants", "b": "Shout to prove the character is emotional", "c": "Use a believable, controlled volume suited to the moment", "d": "Whisper every line even when inaudible", "correct": "c", "rationale": "Screen acting favors audible, context-sensitive delivery.", "points": 1},
  {"code": "ACT-I-009", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Given circumstances", "question": "Which detail is an example of a given circumstance?", "a": "The character has not slept for two days", "b": "The audience’s favorite actor", "c": "The number of likes on the trailer", "d": "The actor’s preferred social media filter", "correct": "a", "rationale": "Given circumstances are facts defining the character’s situation.", "points": 1},
  {"code": "ACT-I-010", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Emotional preparation", "question": "An actor struggles to access sadness. Which approach is most responsible?", "a": "Stop listening to the scene partner", "b": "Demand the crew make them cry", "c": "Focus on the character’s loss, objective and imagined circumstances", "d": "Force real personal trauma until overwhelmed", "correct": "c", "rationale": "Character-centered preparation avoids requiring unsafe personal distress.", "points": 1},
  {"code": "ACT-I-011", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Scene partner collaboration", "question": "During rehearsal your partner suggests a different way to deliver a line. You should:", "a": "Tell the crew they have no authority", "b": "Change the script without informing anyone", "c": "Discuss and test it respectfully within the director’s vision", "d": "Reject every suggestion automatically", "correct": "c", "rationale": "Collaborative experimentation can strengthen a scene when aligned with direction.", "points": 1},
  {"code": "ACT-I-012", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Improvisation", "question": "In a guided improvisation, “yes, and” generally means:", "a": "Accepting a scene offer and building on it", "b": "Adding unrelated jokes to each line", "c": "Agreeing to unsafe actions", "d": "Saying yes to every real-world request", "correct": "a", "rationale": "“Yes, and” means supporting the shared fictional premise, within boundaries.", "points": 1},
  {"code": "ACT-I-013", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Action and motivation", "question": "Which line describes a playable acting tactic rather than an emotion?", "a": "To be nervous", "b": "To intimidate my rival into leaving", "c": "To feel offended", "d": "To look sad", "correct": "b", "rationale": "“To intimidate” describes an action directed toward someone.", "points": 1},
  {"code": "ACT-I-014", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "On-camera performance", "question": "Why might a restrained reaction work better than an exaggerated one in a tight close-up?", "a": "Close-ups cannot record faces clearly", "b": "The camera can capture subtle changes in expression", "c": "Large reactions are banned in cinema", "d": "Small reactions always mean boredom", "correct": "b", "rationale": "Close framing makes subtle details visible; intensity still depends on context.", "points": 1},
  {"code": "ACT-I-015", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Scene transitions", "question": "Two consecutive scenes happen minutes apart in story time but are filmed days apart. An actor should track:", "a": "Only the costume price", "b": "Only how the trailer will be edited", "c": "Only the order in which the scenes were shot", "d": "The character’s emotional and physical state between scenes", "correct": "d", "rationale": "Actors track story continuity across non-sequential filming.", "points": 1},
  {"code": "ACT-I-016", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Auditions", "question": "A casting brief asks for a self-tape with a medium shot and plain background. Best response?", "a": "Follow framing and submission instructions closely", "b": "Ignore the requested scene and perform an advert", "c": "Add loud background music to every line", "d": "Send only a selfie photo", "correct": "a", "rationale": "Following the brief improves assessability and professionalism.", "points": 1},
  {"code": "ACT-I-017", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Accents and language", "question": "A Nigerian character naturally code-switches between English and Pidgin. What should guide the actor?", "a": "A consistent character background and the context of the scene", "b": "Random switches in every sentence", "c": "Imitating a stereotype for laughs", "d": "Using the same accent for every role", "correct": "a", "rationale": "Speech choices should arise from characterization and circumstances.", "points": 1},
  {"code": "ACT-I-018", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Physical business", "question": "When a scene requires pouring water during dialogue, the actor should:", "a": "Focus solely on the water and ignore the partner", "b": "Change the pouring action in every take", "c": "Turn away from the camera throughout", "d": "Rehearse safe, repeatable timing that supports the scene", "correct": "d", "rationale": "Reliable physical business supports performance, safety and editing.", "points": 1},
  {"code": "ACT-I-019", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Notes and adjustment", "question": "A director asks, “Make the apology less defensive.” What is the best next-take approach?", "a": "Repeat the previous take exactly", "b": "Choose a more open, accountable tactic and test it", "c": "Reduce the sound level without changing intention", "d": "Refuse the note because the lines are fixed", "correct": "b", "rationale": "Translate direction into a playable behavioral adjustment.", "points": 1},
  {"code": "ACT-I-020", "level": "Intermediate", "stage": "L2", "module_code": "ACT-I", "category": "Professional boundaries", "question": "During rehearsal, a partner proposes unscripted physical contact. What should happen first?", "a": "Assume consent because the scene is romantic", "b": "Agree on clear consent and choreography before proceeding", "c": "Ask the crew to keep it secret", "d": "Do it once to see if it works", "correct": "b", "rationale": "Physical contact requires explicit agreement and appropriate coordination.", "points": 1},
  {"code": "ACT-A-001", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Competing objectives", "question": "A character desperately needs money but refuses to ask their sibling directly. Which choice best creates layered acting?", "a": "Pursue financial help while protecting pride, shifting tactics as needed", "b": "Play one fixed emotion throughout", "c": "Make each line sound equally angry", "d": "Replace the scene with a monologue", "correct": "a", "rationale": "Conflicting wants produce active, layered choices and tactical shifts.", "points": 1},
  {"code": "ACT-A-002", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Subtext and contradiction", "question": "A mother congratulates her son on leaving Lagos but quietly grips his suitcase. What most clearly creates subtext?", "a": "The scene happens indoors", "b": "The suitcase is a prop", "c": "Her action contradicts the supportive words", "d": "She speaks in a low voice", "correct": "c", "rationale": "The contrast suggests unspoken reluctance or fear.", "points": 1},
  {"code": "ACT-A-003", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Character arc", "question": "Which evidence best demonstrates a character arc across a film?", "a": "The character speaks in every scene", "b": "The character changes clothes frequently", "c": "The character’s beliefs or behavior meaningfully shift under pressure", "d": "The character always repeats the same tactic", "correct": "c", "rationale": "An arc involves meaningful transformation or deliberate resistance to change.", "points": 1},
  {"code": "ACT-A-004", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Tactics and obstacles", "question": "A character’s persuasion stops working midway through a scene. What creates the clearest dramatic progression?", "a": "Turn toward the lens and explain the script", "b": "Change tactic in response to the obstacle while keeping the objective", "c": "Forget the objective until the next scene", "d": "Repeat the same delivery louder", "correct": "b", "rationale": "A new tactic responding to resistance drives dramatic action.", "points": 1},
  {"code": "ACT-A-005", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Acting for coverage", "question": "An actor delivers an explosive revelation in a wide shot and must repeat it for close-ups. The highest priority is to:", "a": "Deliver all lines faster in close-ups", "b": "Reproduce every muscle movement identically", "c": "Create a different backstory for each angle", "d": "Preserve intention, major actions and continuity while remaining responsive", "correct": "d", "rationale": "Consistency of action and intention must coexist with truthful reactions.", "points": 1},
  {"code": "ACT-A-006", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Status and power", "question": "Two characters begin a scene as employer and employee, but the employee reveals decisive evidence. Which performance choice best communicates the power shift?", "a": "Use changes in listening, posture, pacing and tactics to reflect new leverage", "b": "Introduce a new character to explain the shift", "c": "Shout every line from the beginning", "d": "Maintain exactly the same dynamic throughout", "correct": "a", "rationale": "Status shifts emerge through behavior and interaction rather than exposition alone.", "points": 1},
  {"code": "ACT-A-007", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Silence", "question": "Why can a pause be dramatically stronger than an extra line?", "a": "It removes the need for scene objectives", "b": "It guarantees applause", "c": "It can reveal internal processing, choice or resistance", "d": "It always makes the scene longer", "correct": "c", "rationale": "Purposeful silence can externalize internal struggle without additional text.", "points": 1},
  {"code": "ACT-A-008", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Scene structure", "question": "A character discovers halfway through a scene that the person offering help caused the problem. What is the strongest structural consequence?", "a": "Only the background music should change", "b": "Nothing should change", "c": "The actor should forget the earlier relationship", "d": "The discovery can reframe objectives, stakes and tactics", "correct": "d", "rationale": "New information should affect the character’s interpretation and action.", "points": 1},
  {"code": "ACT-A-009", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Emotional continuity", "question": "A grief scene is filmed before the scene depicting the death. How should an actor maintain continuity?", "a": "Wait to see the finished edit", "b": "Map the character’s knowledge, emotional state and story timeline", "c": "Perform maximum sadness in every scene", "d": "Rely on filming order", "correct": "b", "rationale": "A story-timeline map helps sustain coherent emotional progression.", "points": 1},
  {"code": "ACT-A-010", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Acting choice", "question": "Which direction is more playable for an actor?", "a": "Feel a perfect amount of anxiety", "b": "Make the witness trust you without revealing your fear", "c": "Be more interesting", "d": "Be award-winning", "correct": "b", "rationale": "An actionable goal with a constraint gives the actor behavior to pursue.", "points": 1},
  {"code": "ACT-A-011", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Microexpression and restraint", "question": "In a close-up, a politician must hide panic after hearing an accusation. What is the most credible strategy?", "a": "Play an internal impulse to panic while actively trying to conceal it", "b": "Cry openly even though concealment is essential", "c": "Look directly into the lens and wink", "d": "Keep the face completely motionless regardless of stimulus", "correct": "a", "rationale": "A concealed impulse creates tension between inner state and visible control.", "points": 1},
  {"code": "ACT-A-012", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Conflict escalation", "question": "In a comic Lagos scene, a landlord falsely thinks a tenant is wealthy. Which escalation best preserves character logic?", "a": "Introduce unrelated slapstick with no consequences", "b": "Allow every character to know the truth from the start", "c": "Resolve the misunderstanding instantly", "d": "Have the landlord raise demands while the tenant improvises increasingly risky excuses", "correct": "d", "rationale": "Comedy escalates when motivated choices worsen the central predicament.", "points": 1},
  {"code": "ACT-A-013", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Improvisation constraints", "question": "A director permits improvisation but a prop contains an important clue for a later scene. The actor should:", "a": "Ignore the agreed scene objective", "b": "Improvise around the fixed story facts and continuity requirements", "c": "Remove the prop without telling anyone", "d": "Change the clue to surprise the director", "correct": "b", "rationale": "Improvisation should protect story facts and editorial continuity.", "points": 1},
  {"code": "ACT-A-014", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Dialect and authenticity", "question": "An actor portrays a character from a community unfamiliar to them. What is the strongest preparation method?", "a": "Research speech patterns and context, work with informed feedback and avoid caricature", "b": "Use a generic comic imitation", "c": "Avoid character research and rely only on costume", "d": "Copy one viral online impression", "correct": "a", "rationale": "Grounded research and feedback help avoid stereotyping.", "points": 1},
  {"code": "ACT-A-015", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Intimacy and consent", "question": "A director asks for a last-minute change to an intimate scene that exceeds the agreed choreography. Best response?", "a": "Agree because refusal is unprofessional", "b": "Pause and renegotiate boundaries through the appropriate coordination process", "c": "Let the other actor decide for both performers", "d": "Keep the change secret from the production team", "correct": "b", "rationale": "Material changes require renewed consent and coordination; no performer must accept unagreed contact.", "points": 1},
  {"code": "ACT-A-016", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "High-stakes listening", "question": "A scene partner unexpectedly plays a confession with humor rather than tears. The script and stakes remain unchanged. The strongest actor response is to:", "a": "Force the partner to cry before continuing", "b": "Break character and tell the audience about the change", "c": "Ignore the partner and execute preplanned facial cues", "d": "Listen to the actual offer and respond within the character’s objective", "correct": "d", "rationale": "Strong actors adapt truthfully to partners without abandoning the scene’s logic.", "points": 1},
  {"code": "ACT-A-017", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Character contradiction", "question": "A respected doctor secretly falsifies credentials but sincerely cares for a patient. What is the richest acting choice?", "a": "Never show any inner conflict", "b": "Add a confession to each scene", "c": "Let care appear genuine while fear of exposure shapes subtle behavior", "d": "Play only villainy in every moment", "correct": "c", "rationale": "Complex characters can hold authentic care and concealed self-interest simultaneously.", "points": 1},
  {"code": "ACT-A-018", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Editing awareness", "question": "Why should an actor avoid changing the exact timing of an important prop handoff between matching takes?", "a": "The camera cannot capture two actors in a scene", "b": "The sound engineer cannot record props", "c": "Inconsistent action can make intercutting and continuity difficult", "d": "Editors always use only the first take", "correct": "c", "rationale": "Matching action improves editorial flexibility.", "points": 1},
  {"code": "ACT-A-019", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Crisis response", "question": "In rehearsal, an actor seems distressed by a scene involving violence. What is the most professional response?", "a": "Pause and involve the director and relevant safety or welfare lead to adjust the work", "b": "Pressure them to complete the performance", "c": "Record the distress without consent", "d": "Use their distress as a surprise reaction in the take", "correct": "a", "rationale": "Safety and consent take priority over extracting a reaction.", "points": 1},
  {"code": "ACT-A-020", "level": "Advanced", "stage": "L3", "module_code": "ACT-A", "category": "Scene climax", "question": "What makes the decisive moment of a dramatic scene land most effectively?", "a": "The character explains every feeling in a speech", "b": "The camera changes angle more often", "c": "The actor increases volume regardless of meaning", "d": "The choice follows established objectives, obstacles and accumulated pressure", "correct": "d", "rationale": "A climax earns impact through causally built conflict and choice.", "points": 1}
]
$acting$::jsonb) AS q(
  code text, level text, stage text, module_code text, category text,
  question text, a text, b text, c text, d text,
  correct text, rationale text, points numeric
)
WHERE NOT EXISTS (
  SELECT 1 FROM public.academy_question_items i
  WHERE i.external_code = q.code AND i.academy_scope = 'film'
);

-- ─── 2. One published level test per level, on each reachable programme ──────
-- time_limit 30 min for 20 questions (the 15 minutes the four-question L0
-- checkpoints use is not enough here); 3 attempts, matching the precedent and the
-- key's retake guidance. module_id is left out of the column list on purpose: a
-- NULL module keeps these exams outside the module-unlock gate, so they cannot
-- change which lesson a learner is allowed to open.
INSERT INTO public.academy_exams (
  id, program_id, title, description, kind, pass_mark,
  time_limit_minutes, max_attempts, is_published,
  draw_stage, draw_module_codes, draw_count
)
SELECT
  md5('acting-level-exam-' || prog.id || ':' || lvl.key)::uuid,
  prog.id,
  lvl.title,
  'Twenty questions on ' || lvl.scope || ' acting craft. Eighty-five per cent (17 of 20) to pass.',
  'stage_exam', 85, 30, 3, true,
  lvl.stage, ARRAY[lvl.module_code], 20
FROM (
  SELECT id FROM public.academy_programs
   WHERE is_published
     AND ( is_default OR slug = 'screen-acting-foundations-2026' )
) prog
CROSS JOIN (VALUES
  ('beginner',
   'Acting for Camera — Beginner Level Test',
   'L1', 'ACT-B',
   'Beginner craft: script literacy, set language, listening, voice and safety'),
  ('intermediate',
   'Acting for Camera — Intermediate Level Test',
   'L2', 'ACT-I',
   'Objectives, subtext, stakes, continuity, eyelines and scene-partner work'),
  ('advanced',
   'Acting for Camera — Advanced Level Test',
   'L3', 'ACT-A',
   'Arc, status, contradiction, restraint, escalation and edited-scene awareness')
) AS lvl(key, title, stage, module_code, scope)
ON CONFLICT (id) DO NOTHING;
