// Tier 1 — Foundation. What a film is made of, and how a set works.
// No equipment required: this tier is about seeing and reading before doing.
import type { Tier } from './types';

export const TIER_1: Tier = {
  level: 1,
  name: 'Foundation',
  summary:
    'The vocabulary and grammar of film. By the end you can read a scene shot by shot, break a script into its working parts, and walk onto a set knowing who does what.',
  modules: [
    {
      title: 'How a Film Actually Gets Made',
      description:
        'The five stages every film passes through, who owns each one, and why most films fail in the stage nobody budgets for.',
      lessons: [
        {
          title: 'Development, Pre-Production, Production, Post, Delivery',
          description: 'The pipeline end to end, and where Nollywood compresses it.',
          content: `# The five stages

Every film — a ₦500,000 short or a ₦500m feature — moves through the same five stages. What changes is how much time and money each one gets.

**1. Development.** The idea becomes a script. Rights are secured, drafts are written, a producer attaches. This stage is cheap in cash and expensive in time. It is also where most films should die and don't.

**2. Pre-production.** The script becomes a plan: schedule, budget, cast, crew, locations, permits, equipment. Every hour here saves roughly ten on set. The single strongest predictor of whether a shoot goes well is how honestly it was prepped.

**3. Production.** The shoot. The most expensive days of the film's life, measured in crew-hours. Nothing creative that could have been decided earlier should be decided here.

**4. Post-production.** Edit, sound, picture finishing, music, mix. The film is genuinely rewritten here — an assembly is not a film, it is raw material.

**5. Delivery and distribution.** Masters, deliverables, ratings, captions, contracts, release. Films die here too, quietly, for want of paperwork.

## Where Nollywood differs

The Nigerian industry is built on speed and volume, and it compresses stages 1 and 2 hard. A film that would take eighteen months of development elsewhere may go from idea to camera in weeks. That is a genuine competitive strength — it is also why so much of the craft problem in Nigerian film shows up as a *pre-production* problem: unscouted locations, unlocked scripts, sound recorded in rooms nobody listened to first.

The discipline this course teaches is not "spend more". It is: **decide earlier**. Decisions made in pre-production cost a phone call. The same decision on set costs a crew day.

## What to take from this lesson

- Name the five stages without looking.
- Know which stage you are in at any moment on your own project.
- Recognise that "we'll fix it in post" is a budget transfer, not a solution — and usually an expensive one.`,
          videoUrl: 'https://www.youtube.com/watch?v=89NLO7ctLho',
          resourceUrl: 'https://www.youtube.com/watch?v=DfAfv-3SFXs',
          resourceLabel: 'VICE on HBO — inside the Nollywood business',
          minutes: 25,
        },
        {
          title: 'Who Owns the Film at Each Stage',
          description: 'Producer, director, editor — and when authority actually changes hands.',
          content: `# Authority moves

A film has different owners at different times, and confusion about this causes more on-set friction than any creative disagreement.

**Development belongs to the producer and the writer.** The producer decides the film gets made and on what terms. The writer owns the page.

**Pre-production belongs to the producer.** Schedule and budget are producer instruments. A director who overrides them without a conversation is spending someone else's money.

**Production belongs to the director.** On the floor, the director's call is final on performance and coverage. The 1st AD owns the *clock*; the director owns the *content*. These two people must be allies or the day collapses.

**Post belongs to the director and editor**, until the point where contractually it doesn't — on many films the producer or financier holds final cut. Know which you are on before you start.

**Delivery belongs to the producer.** Always.

## The practical version

When you don't know who decides something, ask: *whose stage is it?* Then ask the second question: *is this a content decision or a clock decision?* Content goes to the director. Clock goes to the 1st AD. Money goes to the producer. Almost every on-set dispute resolves cleanly once you name which of the three it is.`,
          videoUrl: 'https://www.youtube.com/watch?v=DfAfv-3SFXs',
          minutes: 20,
        },
        {
          title: 'Reading a Film as a Filmmaker',
          description: 'How to watch actively instead of passively — the habit the whole course rests on.',
          content: `# Watching differently

You already watch films. From now on you watch them twice.

**Pass one: as an audience.** Let it work on you. Note where you leaned in, where you checked your phone, where you felt something. Do not analyse. Feelings first — they are data you cannot recover later.

**Pass two: as a filmmaker.** Take the moments that landed and ask *how*. Specifically:

- Where was the camera, and why there?
- What was the cut doing — was it hiding something, or revealing it?
- What did you hear? Mute the film and watch two minutes. Then close your eyes and listen to two minutes. Sound carries more than beginners believe.
- What did the actor do that a lesser actor would have overplayed?

## The scene log

For the rest of this course, keep a scene log. One page per scene you study:

| Field | What to write |
|---|---|
| Scene | Film, timecode, one-line description |
| Intent | What the scene needs to achieve in the story |
| Coverage | The shots used, in order |
| Turn | The moment the scene changes direction |
| Steal | The one technique you could use in your own work |

The "steal" column is the point. A technique you cannot name, you cannot use.`,
          videoUrl: 'https://www.youtube.com/watch?v=npHWo0Dgb28',
          resourceLabel: 'StudioBinder — how a director directs your attention',
          minutes: 30,
        },
      ],
      quiz: {
        title: 'Quiz — How a Film Gets Made',
        description: 'Five questions on the production pipeline and where authority sits.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'Which stage most reliably determines whether a shoot runs smoothly?',
            type: 'single_choice',
            options: ['Development', 'Pre-production', 'Production', 'Post-production'],
            correct: ['Pre-production'],
            points: 2,
            explanation:
              'Pre-production converts unknowns into decisions while they are still cheap. An hour of prep saves roughly ten on set, because a decision made on the floor costs crew-hours.',
          },
          {
            text: 'On the shooting floor, who owns the clock?',
            type: 'single_choice',
            options: ['The director', 'The 1st AD', 'The producer', 'The DOP'],
            correct: ['The 1st AD'],
            points: 2,
            explanation:
              'The director owns content — performance and coverage. The 1st AD owns the schedule. Keeping these separate is what stops a day collapsing into argument.',
          },
          {
            text: 'Which of these are genuinely decided in post-production rather than merely assembled? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Story structure and scene order', 'The pace of a scene', 'Which lens was used', 'The final mix'],
            correct: ['Story structure and scene order', 'The pace of a scene', 'The final mix'],
            points: 3,
            explanation:
              'Post genuinely rewrites a film — order, rhythm and sound are all authored there. Lens choice is fixed at the moment of shooting and cannot be revisited.',
          },
          {
            text: '"We\'ll fix it in post" is best understood as a budget transfer rather than a solution.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['True'],
            points: 2,
            explanation:
              'The problem does not disappear; its cost moves from a cheap stage to an expensive one, and some problems — bad sound, wrong lens — cannot be fixed at any price.',
          },
          {
            text: 'Who owns delivery?',
            type: 'single_choice',
            options: ['The director', 'The editor', 'The producer', 'The distributor'],
            correct: ['The producer'],
            points: 2,
            explanation:
              'Delivery is a contractual obligation, and the producer carries it. Films are lost at this stage for want of paperwork more often than for want of quality.',
          },
        ],
      },
      assignment: {
        title: 'Scene Log — Three Scenes',
        brief:
          'Choose three scenes from any films you admire, at least one of them Nigerian. Complete a scene log for each using the five fields from Lesson 3 (Scene, Intent, Coverage, Turn, Steal). Submit as a single document or a link to one. Be specific: "the cut lands on her hand, not her face" is useful; "great editing" is not.',
        rubric:
          'Specificity of observation (10) · Correct identification of the scene\'s turn (10) · Coverage described in real shot terms (10) · The "steal" is a technique you could actually execute (10)',
        maxScore: 40,
        dueInDays: 10,
      },
    },
    {
      title: 'The Language of Shots',
      description:
        'Shot sizes, angles and what each one does to an audience. The grammar you will use in every other module.',
      lessons: [
        {
          title: 'Shot Sizes and What They Cost You',
          description: 'From extreme wide to extreme close — and the information each one withholds.',
          content: `# Every shot is a choice about what to hide

A shot size is not a distance. It is a decision about how much of the world the audience is allowed to see.

**Extreme wide (EWS).** The figure is small in a large space. Says: *this place is bigger than this person.* Costs you: the face. You cannot play a subtle performance here.

**Wide / establishing (WS).** Full figure, space legible. The geography shot. Audiences need this earlier than beginners think — disorientation is only useful when it is deliberate.

**Medium (MS).** Waist up. The workhorse of dialogue. Enough body for gesture, enough face for thought.

**Medium close-up (MCU).** Chest up. The news-anchor frame. Intimate but not pressurised.

**Close-up (CU).** Face fills the frame. Says: *this is what matters now.* Its power is finite — a film that lives in close-up has nowhere to escalate.

**Extreme close-up (ECU).** An eye, a hand, a key. Detail as emphasis. Use sparingly or it reads as mannerism.

## The rule that matters

Sizes work by *contrast*, not in isolation. A close-up is only close relative to what preceded it. If you have been in medium for two minutes, a CU lands. If you have been in ECU, it is a relief, not a punch.

This is why coverage is planned as a **sequence**, never as a list.

## Nollywood note

Nigerian screen drama tends to sit in MS and MCU for dialogue — partly a schedule decision, since those sizes are forgiving of small continuity errors and quick to relight. Knowing that is your advantage: when you *do* go to a genuine close-up, it costs the audience nothing and buys you a great deal.`,
          videoUrl: 'https://www.youtube.com/watch?v=wLfZL9PZI9k',
          resourceLabel: 'StudioBinder — every camera shot explained',
          minutes: 30,
        },
        {
          title: 'Angle, Height and Eyeline',
          description: 'Where the camera sits relative to the eye, and the meaning that creates.',
          content: `# Height is meaning

**Eye level.** Neutral. The audience meets the character as an equal. Most of your film should live here, so that departures register.

**Low angle.** Camera below the eyeline, looking up. Conventionally power — but more precisely it is *the world as someone smaller sees it*. Use it as a point of view, not as a label.

**High angle.** Looking down. Conventionally vulnerability. Same caution: it is most powerful when it belongs to an actual observer.

**Dutch / canted.** The horizon tilts. A strong, quickly exhausted effect. If you cannot say in one sentence why the frame is tilted, level it.

## Eyeline is the real subject

An eyeline is where a character is looking, and it is the single most common continuity failure on a low-budget set.

Two rules will save you most of it:

1. **Keep the line.** Once you establish that A looks screen-left toward B, every shot must respect it. Cross the line and the audience feels — without knowing why — that the two people have stopped talking to each other.
2. **Match the height.** If A is standing and B is seated, A's coverage looks down and B's looks up. Shooting both at the same height makes the exchange feel oddly flat, and no amount of editing repairs it.

## Practical drill

Film a two-minute conversation twice: once respecting the line, once deliberately crossing it. Watch both muted. The break is unmistakable, and once you have seen it in your own footage you will never lose it again.`,
          videoUrl: 'https://www.youtube.com/watch?v=IiyBo-qLDeM',
          resourceLabel: 'StudioBinder — camera movement techniques',
          minutes: 30,
        },
        {
          title: 'Coverage: Building a Scene You Can Actually Cut',
          description: 'The minimum set of shots that guarantees an editable scene.',
          content: `# Coverage is insurance

Coverage is the set of angles you shoot so the scene can be assembled. A director who shoots only what they imagine in the edit hands the editor a scene with no escape routes.

## The dependable minimum for a two-hander

1. **A master.** The whole scene, wide enough to show geography, played through.
2. **A clean single on A**, over B's shoulder or clean.
3. **A clean single on B**, matching size and height.
4. **One insert** — the object, the hand, the phone.

That is four setups. It will cut. Everything beyond it is expression, not safety.

## Why the master still matters

Even when you never use it, the master:

- proves the geography, so the audience is never lost;
- gives the editor a place to hide a performance problem;
- is the only shot that records the scene's real rhythm.

Shoot it first, before the actors tire and while the light still matches.

## The overlap rule

Every angle should start slightly before and end slightly after the portion you expect to use. Editors do not cut on the line you imagine; they cut two frames earlier. Give them the frames.

## What "unshootable" looks like

If in the edit you find yourself needing a shot you did not take, the failure was in the shot list, not in the editor. That is why the next module builds one.`,
          videoUrl: 'https://www.youtube.com/watch?v=1GkoINBmbCM',
          resourceLabel: 'Seven foundational cuts — how coverage becomes a scene',
          minutes: 35,
        },
      ],
      quiz: {
        title: 'Quiz — The Language of Shots',
        description: 'Shot sizes, eyelines and the minimum coverage that cuts.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'A close-up is powerful mainly because of…',
            type: 'single_choice',
            options: [
              'The lens used to achieve it',
              'Its contrast with the shots around it',
              'How much light it requires',
              'Its position in the shot list',
            ],
            correct: ['Its contrast with the shots around it'],
            points: 2,
            explanation:
              'Sizes signify by contrast. A CU after sustained mediums lands hard; a CU after a run of extreme close-ups reads as relief. Coverage is designed as a sequence.',
          },
          {
            text: 'What is the minimum dependable coverage for a two-person dialogue scene?',
            type: 'single_choice',
            options: [
              'Two singles',
              'A master and one single',
              'A master, a clean single on each actor, and an insert',
              'A master only',
            ],
            correct: ['A master, a clean single on each actor, and an insert'],
            points: 2,
            explanation:
              'Four setups guarantee the scene assembles. Anything beyond that is expression; anything less removes the editor\'s escape routes.',
          },
          {
            text: 'Crossing the eyeline between two characters in conversation…',
            type: 'single_choice',
            options: [
              'Is corrected in the edit',
              'Makes the two people feel as though they are no longer addressing each other',
              'Only matters in wide shots',
              'Is required for shot–reverse–shot',
            ],
            correct: ['Makes the two people feel as though they are no longer addressing each other'],
            points: 2,
            explanation:
              'The audience registers the break without being able to name it. It cannot be fixed in the edit — only avoided on the day.',
          },
          {
            text: 'Every angle should start before and end after the portion you expect to use.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['True'],
            points: 2,
            explanation:
              'Editors rarely cut exactly where the director imagined. Overlap — handles — is what makes an alternative cut possible at all.',
          },
          {
            text: 'Which shots are chiefly about withholding the face? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Extreme wide shot', 'Close-up', 'Extreme close-up on an object', 'Medium close-up'],
            correct: ['Extreme wide shot', 'Extreme close-up on an object'],
            points: 3,
            explanation:
              'An EWS makes the face unreadable by distance; an ECU on an object excludes it by framing. Both direct attention elsewhere — which is exactly their use.',
          },
        ],
      },
      assignment: {
        title: 'Shot List for a One-Page Scene',
        brief:
          'Write or choose a one-page two-hander. Produce a full shot list: setup number, size, angle, lens if you have a view, movement, and one line on what each shot is FOR. Include your master and at least one insert. Then mark, honestly, which two setups you would drop if you lost an hour.',
        rubric:
          'Coverage would genuinely cut (15) · Each shot has a stated purpose (10) · Eyeline and screen direction consistent (10) · Realistic cut-down under time pressure (5)',
        maxScore: 40,
        dueInDays: 14,
      },
    },

    {
      title: 'Screenwriting Fundamentals: Structure',
      description: 'How a story is built so that it holds — acts, sequences, scenes, and the turn that makes each one necessary.',
      lessons: [
        {
          title: 'Acts, Sequences and the Shape of a Story',
          description: 'Why three acts is a description, not a rule.',
          content: `# Structure is a promise and its payment

Three acts is not a formula imposed on stories; it is a description of how audiences pay attention. **Act One** asks a question. **Act Two** makes answering it cost something. **Act Three** answers it.

More useful at working scale is the **sequence** — roughly 8 to 15 minutes with its own small question and answer. A feature is typically six to eight sequences. Thinking in sequences rather than acts gives you a unit small enough to fix.

## The turn

Every unit — film, sequence, scene — needs a **turn**: the moment the situation stops being what it was. No turn, no scene. This is the most useful single test you can apply to your own pages: *what changes?* If the answer is "we learn something", ask whether the learning changes what anyone can now do. If not, the scene is exposition wearing a costume.

## Setups and payoffs

Anything you pay off must be set up; anything you set up must be paid off or cut. Audiences keep a ledger whether or not they know it.

## The practical test

Write your film as a list of turns, one line each. If the list reads as a story, the structure holds. If it reads as a sequence of events, it does not.`,
          videoUrl: 'https://www.youtube.com/watch?v=CF3lFPW4E1o',
          resourceLabel: 'Lessons from the Screenplay — structure in practice',
          minutes: 30,
        },
        {
          title: 'The Scene as a Unit of Work',
          description: 'Entering late, leaving early, and what a scene is actually for.',
          content: `# One scene, one job

A scene exists to do a single piece of work. Name it in a sentence before you write it: *"She discovers the money is gone."* If you need two sentences, you may have two scenes.

## Enter late, leave early

Begin at the last possible moment and end at the first possible moment. Most first-draft scenes carry a paragraph of throat-clearing at the top and a wind-down at the bottom; both are usually cuttable without loss. In the edit these are exactly the frames that get trimmed — writing them out earlier saves everyone.

## Conflict is not argument

Conflict means two forces that cannot both get what they want. It can be perfectly polite. A scene where everyone agrees and nothing is at stake is where an audience checks its phone.

## Dialogue does four things

It reveals character, advances story, creates or releases tension, or entertains. A line doing none of these is doing nothing. Read your dialogue aloud — the ear catches what the eye forgives.`,
          videoUrl: 'https://www.youtube.com/watch?v=Y5S4PyBR364',
          minutes: 25,
        },
        {
          title: 'Format, Sluglines and Why It Matters',
          description: 'Industry format as a scheduling instrument, not a style preference.',
          content: `# Format is a budget document

Screenplay format looks arbitrary until you realise the whole production reads it as data.

**The slugline** — \`INT. MARKET STALL - DAY\` — tells the 1st AD a location and a time of day, which becomes a scheduling unit. Inconsistent sluglines produce inconsistent schedules.

**One page ≈ one minute** only holds if format holds. This is how a producer estimates length and therefore cost.

**Action lines** describe what the camera can see and the microphone can hear. Not what a character remembers, feels or intends — unless it is visible.

**Character names in caps on first appearance** lets the 1st AD build a day-out-of-days for cast.

## The discipline

Write so the breakdown is possible. A beautifully written script that cannot be broken down is a script that will be rewritten by someone else, badly, at 2am.`,
          videoUrl: '',
          minutes: 20,
        },
      ],
      quiz: {
        title: 'Quiz — Screenwriting Structure',
        description: 'Acts, sequences, the turn, and format as production data.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What is the most reliable test that a scene earns its place?',
            type: 'single_choice',
            options: ['It contains conflict', 'Something turns — the situation stops being what it was', 'It is under three pages', 'It reveals new information'],
            correct: ['Something turns — the situation stops being what it was'],
            points: 2,
            explanation: 'Information alone is exposition. A turn changes what characters can now do, which is what makes the next scene necessary.',
          },
          {
            text: 'Why does screenplay format matter to a producer?',
            type: 'single_choice',
            options: ['It signals professionalism', 'It is read as production data — sluglines become schedule units and pages estimate runtime', 'It is required by festivals', 'It makes dialogue easier to read'],
            correct: ['It is read as production data — sluglines become schedule units and pages estimate runtime'],
            points: 2,
            explanation: 'The breakdown, the schedule and the budget are all derived from format. Inconsistent format produces an inconsistent schedule.',
          },
          {
            text: 'Which of these does dialogue legitimately do? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Reveal character', 'Advance the story', 'Create or release tension', 'Explain what the audience just watched'],
            correct: ['Reveal character', 'Advance the story', 'Create or release tension'],
            points: 3,
            explanation: 'Restating what was just shown is the commonest weak line. If the image carried it, the line is redundant.',
          },
          {
            text: 'Conflict in a scene requires characters to argue.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Conflict means two forces that cannot both be satisfied. Some of the most charged scenes ever written are impeccably polite.',
          },
          {
            text: 'A sequence is best described as…',
            type: 'single_choice',
            options: ['Any group of scenes in one location', 'A unit of roughly 8-15 minutes with its own question and answer', 'The same thing as an act', 'A montage'],
            correct: ['A unit of roughly 8-15 minutes with its own question and answer'],
            points: 2,
            explanation: 'Sequences are small enough to diagnose and fix, which acts are not. Most structural problems are sequence problems.',
          },
        ],
      },
      assignment: {
        title: 'Turn List and a Scene',
        brief: 'Part A: write your short film idea as a list of turns, one line per scene. Part B: write one of those scenes in full industry format, entering late and leaving early. Submit both.',
        rubric: 'Turn list reads as a story rather than a list of events (15) · Scene has a genuine turn (10) · Format is breakdown-ready (10) · Dialogue does real work (5)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
    {
      title: 'Character, Objective and Conflict',
      description: 'Building people an audience will follow, and the engine that makes them act.',
      lessons: [
        {
          title: 'Want, Need and the Gap Between',
          description: 'The two-axis model that makes character arcs legible.',
          content: `# Want is the plot; need is the story

A character's **want** is the concrete thing they are chasing — the money, the role, the marriage. It drives the plot and it is visible.

A character's **need** is what would actually make them whole, and they usually cannot name it. It drives the story and it is invisible.

Drama lives in the gap. When want and need coincide, you have a simple adventure. When they conflict, you have a character who must choose — and choice under pressure is the only reliable way an audience learns who someone is.

## The arc

An arc is not "the character changes". It is: **the character's relationship to their need changes**. They may achieve the want and lose the need (tragedy), abandon the want to serve the need (redemption), or refuse the need entirely (a strong, underused shape).

## Writing it

For each principal, write one line each:

- What do they want, concretely, in this film?
- What do they need, that they cannot say?
- What will force the choice between them?

If you cannot answer the third, you do not yet have a third act.`,
          videoUrl: 'https://www.youtube.com/watch?v=Y5S4PyBR364',
          minutes: 30,
        },
        {
          title: 'Objectives, Obstacles and Tactics',
          description: 'The scene-level engine actors will actually use.',
          content: `# What actors need from your page

Actors do not play emotions; they play **objectives**. An objective is something one character wants *from another*, phrased as an action: *to make her admit it*, *to get him to leave*.

Between the character and the objective stands an **obstacle**. Against the obstacle the character deploys **tactics** — charm, threat, appeal, withdrawal. A scene is interesting when tactics change.

## Why this matters to you as a director

If you give an actor an adjective — "be angrier" — you have given them nothing playable. If you give them a tactic — "try shaming her instead" — the performance changes immediately and specifically. This is the single most useful piece of direction vocabulary in this course, and Module 10 builds on it.

## Diagnosing a flat scene

Ask: what does each person want *from the other*? If either answer is "nothing", that character is furniture, and the scene will die however well it is shot.`,
          videoUrl: 'https://www.youtube.com/watch?v=npHWo0Dgb28',
          minutes: 25,
        },
        {
          title: 'Exposition Without Pain',
          description: 'Getting necessary information across without stopping the film.',
          content: `# Information wants a carrier

Exposition fails when it is delivered by someone with no reason to speak it, to someone with no reason to hear it.

**Give it an argument.** Information delivered inside a disagreement is absorbed painlessly, because the audience is following the fight.

**Give it a resistance.** A character who does not want to explain is far more watchable than one who does.

**Withhold it.** Audiences tolerate confusion much longer than filmmakers expect, and reward it. The question is not "will they understand?" but "do they need to understand *yet*?"

**Show it.** A ledger with red entries beats a line about debt.

## The test

Read the scene and ask who *needs* this said. If the answer is "the audience", rewrite it.`,
          videoUrl: '',
          minutes: 20,
        },
      ],
      quiz: {
        title: 'Quiz — Character and Conflict',
        description: 'Want and need, objectives, tactics, and handling exposition.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'Actors play…',
            type: 'single_choice',
            options: ['Emotions', 'Objectives', 'Subtext', 'Backstory'],
            correct: ['Objectives'],
            points: 2,
            explanation: 'An objective is something one character wants from another, phrased as an action. Emotion is a by-product, never a playable instruction.',
          },
          {
            text: 'Which is a usable direction to an actor?',
            type: 'single_choice',
            options: ['"Be angrier."', '"Try shaming her instead."', '"More energy."', '"Make it sadder."'],
            correct: ['"Try shaming her instead."'],
            points: 2,
            explanation: 'A tactic is playable and changes behaviour immediately. Adjectives describe a result and leave the actor to guess the route.',
          },
          {
            text: 'A character\'s NEED is best described as…',
            type: 'single_choice',
            options: ['The concrete goal driving the plot', 'What would make them whole, which they usually cannot name', 'Their backstory', 'What the antagonist denies them'],
            correct: ['What would make them whole, which they usually cannot name'],
            points: 2,
            explanation: 'Want is visible and drives plot; need is invisible and drives story. Drama lives in the gap between them.',
          },
          {
            text: 'Audiences tolerate temporary confusion far less well than filmmakers assume.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'The reverse is true. Audiences will hold an unanswered question for a long time and enjoy doing so — the real question is whether they need the answer YET.',
          },
          {
            text: 'Which techniques make exposition bearable? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Deliver it inside a disagreement', 'Give the speaker a reason to resist saying it', 'Have a character explain it plainly to a newcomer', 'Show it as an image instead'],
            correct: ['Deliver it inside a disagreement', 'Give the speaker a reason to resist saying it', 'Show it as an image instead'],
            points: 3,
            explanation: 'The newcomer-briefing is the classic failure: nobody in the scene needs it said, only the audience does — which is exactly what makes it audible as exposition.',
          },
        ],
      },
      assignment: {
        title: 'Character Engine',
        brief: 'For the two principals of your short: write want, need, and the event that forces a choice between them. Then take one scene and annotate it — for each character, their objective, the obstacle, and every tactic change. Submit both parts.',
        rubric: 'Want and need are genuinely distinct (10) · The forcing event is specific (10) · Objectives are phrased as actions (10) · Tactic changes are real and marked accurately (10)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
    {
      title: 'Production Roles and the Set Hierarchy',
      description: 'Who does what, who reports to whom, and how to be useful on a set from day one.',
      lessons: [
        {
          title: 'The Departments',
          description: 'A map of a film crew and the logic behind it.',
          content: `# A set is a set of departments

**Production** — producer, line producer, production manager, coordinator. Money, contracts, logistics.

**Direction** — director, 1st AD, 2nd AD, script supervisor. Content and the clock.

**Camera** — DOP, camera operator, 1st AC (focus), 2nd AC (slate, cards), DIT.

**Grip and electric** — gaffer, best boy, electricians; key grip and grips. Light and everything that shapes or supports it.

**Sound** — production sound mixer, boom operator, utility.

**Art** — production designer, art director, set dec, props, standby art.

**Costume, hair and make-up** — designer, supervisor, standby.

**Post** — editor, assistant editor, sound designer, colourist.

## The logic

Departments exist so that a single person can be asked a single question and give a binding answer. That is why you address the **head of department**, not whoever is nearest. Going around an HOD is the fastest way to lose a crew's goodwill.`,
          videoUrl: 'https://www.youtube.com/watch?v=DfAfv-3SFXs',
          minutes: 25,
        },
        {
          title: 'The 1st AD and the Shape of a Shooting Day',
          description: 'Call sheets, the running order, and why the day is built the way it is.',
          content: `# The day has a structure

A shooting day is not a list of scenes; it is an optimisation. Scenes are grouped by **location**, then by **lighting setup**, then by **cast availability** — because moving a unit and relighting a room are the two most expensive things you can do.

This is why films shoot out of order, and why the schedule sometimes looks perverse from a story point of view.

**The call sheet** is the contract for the day: call times per department, scenes and pages, cast, location, weather, sunrise and sunset, hospital address. If it is not on the call sheet, it is not happening.

**"Turning around"** means reversing the camera to shoot the opposite angle — a lighting event, not just a camera move, which is why it is scheduled rather than improvised.

## How to be useful

Know the call sheet before you arrive. Know which scene is up. Never be the reason a department is waiting.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Set Etiquette and Communication',
          description: 'The small conventions that keep a large group working safely and fast.',
          content: `# The conventions exist for a reason

**Do not touch another department's equipment.** Not the light, not the boom, not the props. It is not precious — it is that someone has set that object and needs to trust its position.

**Repeat back.** When given an instruction on radio or in person, repeat it. Sets are loud and half-heard instructions cost hours.

**Say "flashing"** before a strobe, **"striking"** before a light comes down, **"hot points"** when moving hardware through a crowd. These are safety calls.

**Silence on "roll sound".** From "roll sound" to "cut", the only people who speak are the director, the AD, and anyone stopping the take for safety.

**Anyone can stop a take for safety.** Nobody is ever penalised for it. This is not a courtesy — it is the rule that keeps sets survivable, and Module 6 develops it.

## Why this matters more on small crews

On a large set the conventions are enforced by numbers. On a five-person Nigerian indie crew, they are enforced only by you.`,
          videoUrl: '',
          minutes: 20,
        },
      ],
      quiz: {
        title: 'Quiz — Roles and the Set',
        description: 'Departments, the shooting day, and set conventions.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'A shooting day is ordered primarily by…',
            type: 'single_choice',
            options: ['Story order', 'Location, then lighting setup, then cast availability', 'Director preference', 'Scene length'],
            correct: ['Location, then lighting setup, then cast availability'],
            points: 2,
            explanation: 'Moving the unit and relighting are the two most expensive events of a day, so the schedule minimises them — which is why films shoot out of order.',
          },
          {
            text: 'Who may stop a take for safety?',
            type: 'single_choice',
            options: ['The director only', 'The 1st AD only', 'Any head of department', 'Anyone on set'],
            correct: ['Anyone on set'],
            points: 2,
            explanation: 'Anyone, without exception and without penalty. A set where people hesitate to call a stop is a set waiting for an injury.',
          },
          {
            text: 'Why address the head of department rather than whoever is nearest?',
            type: 'single_choice',
            options: ['Seniority and courtesy', 'So one person can give a binding answer for that department', 'Union rules', 'It is faster'],
            correct: ['So one person can give a binding answer for that department'],
            points: 2,
            explanation: 'Departments exist to make authority unambiguous. Going around an HOD produces contradictory instructions and lost goodwill.',
          },
          {
            text: 'If something is not on the call sheet, it is not happening.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['True'],
            points: 2,
            explanation: 'The call sheet is the day\'s contract. Work that is not on it has not been resourced, scheduled or communicated.',
          },
          {
            text: 'Which of these are safety calls? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['"Flashing"', '"Striking"', '"Hot points"', '"Turning around"'],
            correct: ['"Flashing"', '"Striking"', '"Hot points"'],
            points: 3,
            explanation: '"Turning around" is a scheduling and lighting term — reversing the camera for the opposite angle. The other three warn people of a physical hazard.',
          },
        ],
      },
      assignment: {
        title: 'Read a Call Sheet',
        brief: 'Obtain or reconstruct a call sheet for a real or planned shoot day. Annotate it: identify each department\'s call time and explain WHY the day is ordered as it is. Then identify two scheduling risks and what you would do about them.',
        rubric: 'Correct reading of the running order (10) · Sound explanation of the grouping logic (10) · Risks are real and specific (10)',
        maxScore: 30,
        dueInDays: 10,
      },
    },
    {
      title: 'Safety, Ethics and Conduct on Set',
      description: 'The non-negotiables. This module is required and its assessment must be passed before any practical work.',
      lessons: [
        {
          title: 'Physical Safety',
          description: 'Electricity, rigging, vehicles, water, crowds, heat.',
          content: `# The hazards that actually hurt film crews

**Electrical.** Generators, distribution, cabling in wet conditions. Cables get taped or matted, never left loose across a walkway. Anything drawing serious current is the gaffer's call — not "someone who knows a bit about wiring".

**Rigging and overheads.** Anything above head height gets a secondary safety — a safety cable or chain, independent of the primary mount. Lights fall. This is why nobody stands under a rigged fixture during a change.

**Vehicles.** A car in a shot is a hazard, not a prop. Process shots, tracking vehicles and anything moving with a camera attached require a dedicated person whose only job is watching for danger.

**Heat and fatigue.** In Nigerian daytime exteriors, heat is the most under-treated risk on set. Water, shade and honest turnaround times are safety equipment.

**Crowds.** Extras must be briefed on where they may walk and what the stop signal is.

## Turnaround

The gap between wrap and next call. Cutting turnaround produces tired crews, and tired crews are how people get hurt. It is a safety measure, not a comfort.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Consent, Dignity and Intimacy',
          description: 'Working with performers, minors, and communities.',
          content: `# Consent is specific, informed and revocable

**Specific.** Consent to be filmed is not consent to any use. Release forms state the use.

**Informed.** A performer must know before the day what will be required — particularly for intimacy, nudity, violence, or anything involving fear or physical risk. Sprung requests are coercive by construction, whatever the intention.

**Revocable.** A performer may withdraw. Building a schedule that makes withdrawal impossible is a form of pressure.

## Intimate scenes

Closed set, agreed choreography in advance, and — wherever the budget allows — an intimacy coordinator. Choreograph intimacy exactly as you would choreograph a fight: rehearsed, specific, repeatable, never improvised on the day.

## Minors

Statutory limits on hours, mandatory guardian presence, and content limits. These are not adjustable by agreement.

## Communities and locations

Filming in a real neighbourhood imposes on people who did not sign anything. Ask, inform, compensate where appropriate, and leave the place as you found it. Nollywood's access to real locations is one of its great assets; it survives only on goodwill.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Harassment, Power and Reporting',
          description: 'How power concentrates on a film set, and what a functioning reporting route looks like.',
          content: `# Sets concentrate power

Short contracts, informal hiring, long hours, physical proximity, and a culture that prizes not making a fuss. Every one of these makes a set a place where harassment is easy and reporting is hard.

## What a working policy requires

- A named person to report to who is **not** the director or the direct hirer.
- A route that functions when the person complained of is the most powerful person present.
- No retaliation, stated explicitly and enforced visibly.
- Consequences that apply regardless of seniority or how central the person is to the schedule.

## Your responsibility as a crew member

If you witness it, you are not a bystander. Say something at the time if it is safe, and report it after if it is not.

## As a director or producer

The tone is set by what you tolerate on day one, not by what your policy document says. A crew learns very quickly whether the rules apply to the people who matter to the schedule.

**This module's assessment is compulsory and must be passed before any practical work in Tier 5.**`,
          videoUrl: '',
          minutes: 20,
        },
      ],
      quiz: {
        title: 'Assessment — Safety and Conduct (compulsory)',
        description: 'Must be passed before practical work. Higher pass mark than other modules.',
        passMark: 85,
        timeLimitMinutes: 20,
        maxAttempts: 5,
        questions: [
          {
            text: 'Consent from a performer is…',
            type: 'multiple_choice',
            options: ['Specific to a stated use', 'Informed in advance of the day', 'Revocable', 'Permanent once a release is signed'],
            correct: ['Specific to a stated use', 'Informed in advance of the day', 'Revocable'],
            points: 4,
            explanation: 'A signed release does not make consent permanent or unlimited. Requirements sprung on the day are coercive by construction, whatever the intent.',
          },
          {
            text: 'Anything rigged above head height requires…',
            type: 'single_choice',
            options: ['A qualified operator', 'A secondary safety independent of the primary mount', 'Insurance documentation', 'A written risk assessment only'],
            correct: ['A secondary safety independent of the primary mount'],
            points: 3,
            explanation: 'Primary mounts fail. The safety cable or chain is what stands between a failure and a serious injury, which is why nobody stands underneath during a change.',
          },
          {
            text: 'Cutting turnaround between wrap and the next call is a scheduling decision with no safety implications.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 3,
            explanation: 'Turnaround is a safety measure. Fatigue is a direct cause of set injuries, and it is the risk most often traded away under schedule pressure.',
          },
          {
            text: 'A harassment reporting route must, above all…',
            type: 'single_choice',
            options: ['Be documented in the crew deal memo', 'Function when the person complained of is the most powerful person present', 'Be managed by the producer', 'Guarantee anonymity'],
            correct: ['Function when the person complained of is the most powerful person present'],
            points: 3,
            explanation: 'Any route that quietly fails at the top is not a route. That is precisely the case it exists to handle.',
          },
          {
            text: 'How should an intimate scene be handled?',
            type: 'single_choice',
            options: ['Improvised for authenticity', 'Choreographed in advance, agreed, on a closed set', 'Shot in a single take to reduce exposure', 'Left to the actors to arrange privately'],
            correct: ['Choreographed in advance, agreed, on a closed set'],
            points: 3,
            explanation: 'Intimacy is choreographed exactly like a fight — rehearsed, specific and repeatable. Improvisation here removes the performer\'s ability to consent to a known plan.',
          },
          {
            text: 'You witness a senior crew member harassing a junior. You are freelance and mid-contract. What is your responsibility?',
            type: 'single_choice',
            options: ['Nothing — it is not your department', 'Raise it at the time if safe, and report it afterwards if not', 'Tell the person to handle it themselves', 'Wait until the production wraps'],
            correct: ['Raise it at the time if safe, and report it afterwards if not'],
            points: 4,
            explanation: 'Witnessing is not neutrality. The reporting route exists precisely so that a junior person is not left to challenge power alone.',
          },
        ],
      },
      assignment: {
        title: 'Risk Assessment for Your Shoot',
        brief: 'Produce a written risk assessment for a location you intend to shoot in. Identify each hazard, its likelihood and severity, and the control measure. Include electrical, rigging, heat, crowd and vehicle hazards where relevant. State who your safety contact is and what your reporting route is.',
        rubric: 'Hazards identified are real and location-specific (15) · Controls are practical and named (10) · Reporting route functions independently of the director (10) · Heat, water and turnaround addressed (5)',
        maxScore: 40,
        dueInDays: 7,
      },
    },
  ],
  assessment: {
    title: 'Tier 1 Assessment — Foundation',
    description: 'Covers all six Foundation modules. Pass to unlock Tier 2.',
    passMark: 75,
    timeLimitMinutes: 45,
    maxAttempts: 3,
    questions: [
      {
        text: 'A scene has no turn. What is the most likely diagnosis?',
        type: 'single_choice',
        options: ['It is too short', 'It is exposition rather than drama', 'It needs more coverage', 'The dialogue is weak'],
        correct: ['It is exposition rather than drama'],
        points: 3,
        explanation: 'Coverage and dialogue cannot rescue a scene in which nothing changes. The fix is structural, on the page.',
      },
      {
        text: 'You lose an hour on a two-hander. Which setup do you protect?',
        type: 'single_choice',
        options: ['The master', 'The insert', 'A second angle on the lead', 'A cutaway'],
        correct: ['The master'],
        points: 3,
        explanation: 'The master proves geography, records the real rhythm and gives the editor somewhere to hide a problem. It is the last thing to drop.',
      },
      {
        text: 'Which are true of the 1st AD? (Choose all that apply.)',
        type: 'multiple_choice',
        options: ['Owns the clock', 'Owns performance', 'Runs the floor', 'Issues the call sheet'],
        correct: ['Owns the clock', 'Runs the floor', 'Issues the call sheet'],
        points: 4,
        explanation: 'Performance belongs to the director. Separating content from clock is what keeps the two roles from colliding.',
      },
      {
        text: 'Giving an actor an adjective is weaker direction than giving them a tactic.',
        type: 'true_false',
        options: ['True', 'False'],
        correct: ['True'],
        points: 3,
        explanation: 'An adjective names a result and leaves the route to chance. A tactic is playable and changes behaviour immediately.',
      },
      {
        text: 'Which is the strongest justification for shooting out of story order?',
        type: 'single_choice',
        options: ['It suits the actors', 'It minimises unit moves and relights, the two costliest events of a day', 'It is industry convention', 'It gives the editor more options'],
        correct: ['It minimises unit moves and relights, the two costliest events of a day'],
        points: 3,
        explanation: 'The schedule is an optimisation against cost. Story order is almost never the cheapest order.',
      },
    ],
  },
};
