// Tier 5 — Capstone. Everything above, applied to one film you actually finish.
import type { Tier } from './types';

export const TIER_5: Tier = {
  level: 5,
  name: 'Capstone',
  summary:
    'Plan, shoot, finish and deliver a short film. Assessed on the work itself and on the discipline behind it. Tier 1 Module 6 (Safety and Conduct) must be passed before any practical work begins.',
  modules: [
    {
      title: 'Pre-Production Practicum',
      description: 'Take your short from script to a shootable plan, assessed as a package.',
      lessons: [
        {
          title: 'Locking the Script',
          description: 'The point at which rewriting stops and planning begins.',
          content: `# Lock means lock

A locked script has **numbered scenes that stop moving**. Every department plans against those numbers. After lock, changes are issued as coloured revision pages so everyone can see exactly what changed and when.

Locking too early wastes prep on a script that is still moving. Locking too late means nobody can prep at all — and on a short schedule that is fatal.

## The readiness test

Before you lock, confirm:

- Every scene has a turn (Module 3).
- Every character wants something from someone (Module 4).
- You can name what the film is about in one sentence.
- Every location in the script is one you can actually get.
- Nothing in it costs money you do not have.

That last point is where most first films fail. A script requiring a crowd, a car chase and a rainstorm is not a brave plan; it is an unfinished film.

## Writing to your resources

Rewriting to fit what you have is not a compromise — it is the central skill of independent filmmaking. A scene relocated from a busy market to a single room may well be better, because constraint forces specificity.`,
          videoUrl: 'https://www.youtube.com/watch?v=TLreJgMuNMA',
          minutes: 25,
        },
        {
          title: 'Assembling the Package',
          description: 'Every document a shoot needs, and who reads it.',
          content: `# The prep package

By the end of prep you should hold:

- **Locked script** with numbered scenes.
- **Breakdown** in eighths, every element listed (Module 20).
- **Stripboard and shooting order**, grouped by location and lighting.
- **Budget** with contingency, and a cash-flow plan for when money is actually needed.
- **Shot list and blocking diagrams** per scene (Modules 2 and 8).
- **Cast and crew agreements**, and the chain-of-title file (Module 21).
- **Location agreements** and a recce report per location (Module 12).
- **Risk assessment** per location, with a named safety contact and reporting route (Module 6).
- **Call sheets** for at least day one.
- **Continuity plan** — who is lining the script and logging takes (Module 13).

## The test of a good package

Hand it to someone who has never discussed the film with you. If they can tell you what happens on day one, hour by hour, and what it costs — the package works. If they need you to explain it, it is not a package; it is a set of notes.`,
          videoUrl: '',
          minutes: 30,
        },
        {
          title: 'Rehearsal and the Final Week',
          description: 'What to settle before the first call sheet.',
          content: `# The last seven days

**Rehearse.** Blocking and the shape of scenes, not the emotional peaks (Module 11). Rehearse anything technically difficult — a oner, a stunt, an effect — until it is reliable.

**Confirm everything in writing.** Locations, cast, crew, equipment, transport. A verbal confirmation a week out is not a confirmation.

**Walk the locations again**, at your shooting hour, with the shot list in hand. Things change: a building goes up, a generator arrives, a road closes.

**Test the kit.** Every camera, every card, every light, every cable, every battery. On the day is not the moment to discover a dead card reader.

**Brief the crew** on the safety plan and the reporting route. Say it out loud on day one. What you say on day one is what the crew believes the rules are.

## The thing to accept

Something will go wrong. The plan is not there to prevent that; it is there so that when it happens you have the slack, the information and the alternatives to absorb it.`,
          videoUrl: '',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Pre-Production Practicum',
        description: 'Script lock, the prep package and final-week discipline.',
        passMark: 75,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What does locking a script mean in practice?',
            type: 'single_choice',
            options: ['No further changes are permitted', 'Scene numbers stop moving and later changes are issued as tracked revision pages', 'The producer approves the final draft', 'The script is registered for copyright'],
            correct: ['Scene numbers stop moving and later changes are issued as tracked revision pages'],
            points: 2,
            explanation: 'Every department plans against scene numbers. Lock fixes those numbers so a change can be communicated precisely rather than silently.',
          },
          {
            text: 'What is the test of a good prep package?',
            type: 'single_choice',
            options: ['It is complete and well formatted', 'Someone who has never discussed the film can tell you what happens on day one and what it costs', 'The director approves it', 'It fits in one binder'],
            correct: ['Someone who has never discussed the film can tell you what happens on day one and what it costs'],
            points: 2,
            explanation: 'A package that needs you present to explain it is a set of notes. The point is that it works without you in the room.',
          },
          {
            text: 'Rewriting a scene to fit available resources is…',
            type: 'single_choice',
            options: ['A compromise that weakens the film', 'The central skill of independent filmmaking, and often improves the scene', 'Only acceptable on shorts', 'A failure of ambition'],
            correct: ['The central skill of independent filmmaking, and often improves the scene'],
            points: 2,
            explanation: 'Constraint forces specificity. A script demanding what you cannot afford is not brave — it is an unfinished film.',
          },
          {
            text: 'A verbal confirmation from a location owner a week before the shoot is sufficient.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Confirm everything in writing. A verbal arrangement gives you no recourse and no clarity about hours, alterations or overrun.',
          },
          {
            text: 'Which must be complete before any practical work in this tier? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['A risk assessment per location', 'A named safety contact and reporting route', 'A passed Module 6 assessment', 'The final grade'],
            correct: ['A risk assessment per location', 'A named safety contact and reporting route', 'A passed Module 6 assessment'],
            points: 3,
            explanation: 'Safety and conduct is a gate, not a formality. The grade belongs to post and cannot precede the shoot.',
          },
        ],
      },
      assignment: {
        title: 'The Full Prep Package',
        brief: 'Submit a complete, shootable prep package for your short: locked script, breakdown in eighths, stripboard and shooting order, budget with contingency and cash flow, shot lists with blocking diagrams, cast and crew agreements, chain-of-title file, location agreements and recce reports, risk assessments with a named safety contact, day-one call sheet, and your continuity plan. This is assessed as a package — a missing document is a missing mark.',
        rubric: 'Script genuinely locked and shootable within resources (15) · Breakdown exhaustive (15) · Schedule realistic at 2-4 pages/day and minimises moves (15) · Budget honest with contingency (15) · Rights and location paperwork complete (20) · Risk assessments specific with a working reporting route (20)',
        maxScore: 100,
        dueInDays: 30,
      },
    },
    {
      title: 'Capstone — Shoot, Finish, Deliver',
      description: 'Produce the film. Assessed on the finished work and on the professional record behind it.',
      lessons: [
        {
          title: 'Running Your Own Set',
          description: 'Holding the day together when you are also the author.',
          content: `# The day belongs to the plan

On your own film you will be tempted to chase perfection at the cost of the schedule. Resist it. **A finished imperfect film beats an unfinished perfect one**, always, and it is the only one anyone will ever see.

## The disciplines

- **Shoot the master first** while energy and light are consistent (Module 2).
- **Know when you have it** and move (Module 11).
- **Protect the close-up** in the schedule, because that is where you will cut.
- **Check every line is covered** before wrapping a scene (Module 13).
- **Record room tone** at every location (Module 10).
- **Photograph every setup** before you strike it (Modules 12, 13).

## When you fall behind

You will. The options, in order of preference: simplify the coverage, simplify the blocking, combine setups, drop a pre-identified drop scene. The option that is *never* on the list is cutting turnaround or skipping the safety brief.

## Being the director and the producer

If you are both, name someone else as the safety contact. A reporting route that leads back to the most powerful person on set is not a route (Module 6).`,
          videoUrl: 'https://www.youtube.com/watch?v=PWRRMIkCrWs',
          minutes: 30,
        },
        {
          title: 'Finishing Without Losing the Film',
          description: 'Post discipline for a film you are too close to.',
          content: `# Distance is a technique

**Back up before anything else** — two copies, separate devices (Module 14).

**Watch all the rushes** before cutting, and take fresh notes. What played on set often does not play in the bin.

**Assemble long, then leave it alone for a few days.** You cannot see your own film until you have stopped looking at it.

**Show it to people chosen for honesty**, and ask comprehension questions, not taste questions (Module 15).

**Cut silent before you add music** (Module 15). If the scene needs score to work, it does not yet work.

**Lock picture properly** before sound and grade begin (Modules 16-19).

## Delivering

Deliver to a real spec. QC the master end to end. Produce your M&E, subtitles, credits and chain-of-title summary (Module 19). Archive everything on two devices in two places.

## What you are being assessed on

Not whether the film is a masterpiece. Whether it is **finished, coherent, competently made, honestly delivered and properly documented** — which is what makes someone employable, and what makes a second film possible.`,
          videoUrl: 'https://www.youtube.com/watch?v=PWRRMIkCrWs',
          minutes: 30,
        },
        {
          title: 'The Post-Mortem',
          description: 'The habit that turns one film into a career.',
          content: `# What actually happened

Within two weeks of delivery, while it is still accurate, write an honest account:

- **Schedule.** Planned versus actual, day by day. Where did you lose time, and to what?
- **Budget.** Planned versus actual, line by line. What did you under-estimate?
- **Craft.** Which scenes work? Which do not, and at what stage did that become inevitable — script, shoot or edit?
- **People.** Who would you work with again? Who did you fail to support?
- **Safety and conduct.** Did anything happen that should not have? Was the reporting route ever used, and did it work?

## Why this matters more than the film

The film is one data point. The post-mortem is what converts it into knowledge you carry to the next one. Directors who make the same mistake on three films in a row are almost always directors who never wrote down what went wrong on the first.

## Submit it

Your post-mortem is part of your capstone assessment. It is marked on **honesty and specificity**, not on how well the shoot went. A frank account of a difficult shoot scores higher than a comfortable account of an easy one.`,
          videoUrl: '',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Capstone Practice',
        description: 'Set discipline, post discipline and the post-mortem.',
        passMark: 75,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'You are running behind schedule. Which option is NEVER acceptable?',
            type: 'single_choice',
            options: ['Simplifying the coverage', 'Combining setups', 'Cutting turnaround or skipping the safety brief', 'Dropping a pre-identified drop scene'],
            correct: ['Cutting turnaround or skipping the safety brief'],
            points: 3,
            explanation: 'Turnaround is a safety measure and fatigue causes injuries. Everything else on the list is a legitimate creative or logistical trade.',
          },
          {
            text: 'If you are both director and producer, who should be the safety contact?',
            type: 'single_choice',
            options: ['You, since you hold responsibility', 'The 1st AD, reporting to you', 'Someone else, so the route does not lead back to the most powerful person on set', 'The insurer'],
            correct: ['Someone else, so the route does not lead back to the most powerful person on set'],
            points: 3,
            explanation: 'A reporting route that terminates at the person who might be complained of is not a route at all.',
          },
          {
            text: 'The capstone is assessed principally on…',
            type: 'single_choice',
            options: ['Artistic originality', 'Whether the film is finished, coherent, competently made, honestly delivered and documented', 'Production value', 'Festival acceptance'],
            correct: ['Whether the film is finished, coherent, competently made, honestly delivered and documented'],
            points: 2,
            explanation: 'That combination is what makes someone employable and what makes a second film possible. A finished imperfect film beats an unfinished perfect one.',
          },
          {
            text: 'A post-mortem describing a difficult shoot honestly scores lower than one describing a smooth shoot.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'It is marked on honesty and specificity, not on how well the shoot went. The point is the knowledge carried to the next film.',
          },
          {
            text: 'Which are correct post-production disciplines? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Back up twice before importing', 'Assemble long, then leave it for a few days', 'Cut silent before adding music', 'Grade before picture lock'],
            correct: ['Back up twice before importing', 'Assemble long, then leave it for a few days', 'Cut silent before adding music'],
            points: 3,
            explanation: 'Grading before picture lock wastes the work — the grade is built against specific frames that will move.',
          },
        ],
      },
      assignment: {
        title: 'Capstone Submission',
        brief: 'Submit: (1) the finished short film, delivered to a stated spec with M&E, subtitles and credits; (2) the chain-of-title summary; (3) the archive manifest listing what is stored and where; (4) your honest post-mortem covering schedule, budget, craft, people, and safety and conduct. Late or missing components are marked as missing — delivery discipline is part of the assessment.',
        rubric: 'Film is finished and coherent (30) · Craft competence across image and sound (25) · Delivered correctly to a real spec with all components (20) · Chain of title complete (10) · Post-mortem honest and specific (15)',
        maxScore: 100,
        dueInDays: 60,
      },
    },
  ],
  assessment: {
    title: 'Tier 5 Assessment — Professional Practice',
    description: 'Final assessment. Covers judgement under pressure across the whole pathway.',
    passMark: 80,
    timeLimitMinutes: 60,
    maxAttempts: 3,
    questions: [
      {
        text: 'It is 6pm on day four of five. You have two scenes left today and light for one. What do you do?',
        type: 'single_choice',
        options: ['Shoot both quickly with minimal coverage', 'Extend the day and cut turnaround', 'Shoot the scene that matters most properly, and move the other to your pre-identified drop list', 'Shoot wide masters only for both'],
        correct: ['Shoot the scene that matters most properly, and move the other to your pre-identified drop list'],
        points: 4,
        explanation: 'This is why drop scenes are identified in prep, not at 6pm. Two rushed scenes usually yields two unusable ones; turnaround is never the trade.',
      },
      {
        text: 'Your lead actor is uncomfortable with a scene agreed weeks ago. The correct response is…',
        type: 'single_choice',
        options: ['Remind them it was agreed and shoot it', 'Stop, discuss, and re-choreograph or drop it — consent is revocable', 'Shoot it in one take to minimise exposure', 'Ask the producer to intervene'],
        correct: ['Stop, discuss, and re-choreograph or drop it — consent is revocable'],
        points: 4,
        explanation: 'Consent is specific, informed AND revocable. A prior agreement does not convert a performer\'s present objection into permission.',
      },
      {
        text: 'Which failures on the day are effectively unrecoverable in post? (Choose all that apply.)',
        type: 'multiple_choice',
        options: ['Dialogue lost to a reverberant room and traffic', 'A line not covered from any usable angle', 'A flat, uncorrected image', 'Crossing the eyeline throughout a scene'],
        correct: ['Dialogue lost to a reverberant room and traffic', 'A line not covered from any usable angle', 'Crossing the eyeline throughout a scene'],
        points: 4,
        explanation: 'A flat image is a grade away from fixed. The other three are decided on the floor: sound is baked in, missing coverage means a reshoot, and a crossed line cannot be uncrossed.',
      },
      {
        text: 'A platform offers a deal requiring delivery in three weeks. You have no M&E track, no captions and an uncleared music track. You should sign and sort it out during the window.',
        type: 'true_false',
        options: ['True', 'False'],
        correct: ['False'],
        points: 4,
        explanation: 'Uncleared music cannot be reliably cleared under deadline pressure, and missing deliverables routinely stall releases. Committing to a delivery you cannot make is how a deal becomes a breach.',
      },
      {
        text: 'Your finished film is competent but not the film you imagined. What is the professionally correct conclusion?',
        type: 'single_choice',
        options: ['Recut it until it matches the intention', 'Deliver it, document what you learned in a post-mortem, and apply it to the next film', 'Withhold it from release', 'Reshoot the weakest scenes'],
        correct: ['Deliver it, document what you learned in a post-mortem, and apply it to the next film'],
        points: 4,
        explanation: 'A finished imperfect film beats an unfinished perfect one, and the post-mortem is what converts one film into a career rather than one repeated mistake.',
      },
    ],
  },
};
