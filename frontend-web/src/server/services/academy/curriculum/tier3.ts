// Tier 3 — Post. Where the film is genuinely written for the second time.
import type { Tier } from './types';

export const TIER_3: Tier = {
  level: 3,
  name: 'Post-Production',
  summary:
    'Assembly, rhythm, colour, sound and finishing. You will finish able to cut a scene that plays, mix dialogue that is intelligible, and deliver a file that a platform will accept.',
  modules: [
    {
      title: 'Editing I — Assembly and the Cut',
      description: 'Organising rushes, building an assembly, and the mechanics of why a cut works.',
      lessons: [
        {
          title: 'Before You Cut Anything: Organisation',
          description: 'The unglamorous work that determines whether post is survivable.',
          content: `# Post begins with filing

**Back up first, twice.** Two copies on separate physical devices before a single frame is imported. Cards are not backups. A production that loses its rushes has lost the film, and it happens.

**Sync and label.** Marry audio to picture, name clips by scene and take, and build bins per scene. An hour here saves days later.

**Watch everything.** All of it, once, before cutting. Take notes on what actually plays — which will differ from the take notes made on the day, because the floor is a bad place to judge performance.

## The selects reel

Pull the takes that work into a selects sequence per scene before assembling. You are reducing a mountain to a shortlist, and the shortlist is where the film starts to appear.

## The assembly

Cut every scene, in order, long. Do not refine. The assembly is deliberately baggy — its purpose is to show you the film's real shape, which is never the shape of the script.`,
          videoUrl: 'https://www.youtube.com/watch?v=1GkoINBmbCM',
          minutes: 30,
        },
        {
          title: 'Why a Cut Works',
          description: 'Continuity, eyeline, motion and the mechanics of invisibility.',
          content: `# The cut the audience does not see

**Match on action.** Cut in the middle of a movement, and the eye follows the motion across the join. The most reliable invisible cut there is.

**Eyeline match.** A looks off-screen; cut to what A sees. The audience assembles the geography for you.

**Cut on the turn of the head, the blink, the breath.** Bodies punctuate themselves; cut where they do.

**The 30-degree rule.** Cutting between two angles less than roughly 30 degrees apart produces a jump. Either move meaningfully or change size.

## The real question

Every cut answers: *why now?* The usual answers are — the information has landed, the audience wants to see the reaction, or the rhythm demands it. A cut with no answer is a habit.

## J and L cuts

Let sound lead picture (J) or trail it (L). Almost every dialogue scene in professional work does this; hard-matched audio and video cuts make a scene feel mechanical.`,
          videoUrl: 'https://www.youtube.com/watch?v=YtULPT1aBWM',
          resourceUrl: 'https://www.youtube.com/watch?v=SxfRbTOaCuY',
          resourceLabel: 'Transitions every filmmaker should know',
          minutes: 30,
        },
        {
          title: 'Cutting a Dialogue Scene',
          description: 'Where to sit, when to move, and the reaction shot.',
          content: `# Listening is more interesting than speaking

The beginner cuts to whoever is talking. The result is a tennis match. The professional often stays on the **listener** — because the audience wants to see the line land, and reaction is where meaning is confirmed.

## A working method

1. Lay the scene in the master, complete. Hear its natural rhythm.
2. Cut in to singles only where you need to be closer — a turn, a revelation, a lie.
3. Ask at every cut: am I moving because the story needs it, or because I am bored? Boredom is a scene problem, not an editing problem.

## Trimming

Most first cuts are 20% too long, and almost all of it is at the heads and tails of shots. Trim the front of every shot as far as you dare — then one frame further.

## Performance selection

You are not choosing the best take; you are choosing the best *moment* from each take, and stitching. That is what coverage bought you.`,
          videoUrl: 'https://www.youtube.com/watch?v=uWrY66MRAnM',
          minutes: 30,
        },
      ],
      quiz: {
        title: 'Quiz — Editing I',
        description: 'Organisation, cut mechanics and dialogue scenes.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What must happen before a single frame is imported?',
            type: 'single_choice',
            options: ['The assembly is planned', 'Two backups exist on separate physical devices', 'The music is chosen', 'The director approves the selects'],
            correct: ['Two backups exist on separate physical devices'],
            points: 2,
            explanation: 'Cards are not backups. A production that loses its rushes has lost the film, and this is the single cheapest catastrophic risk to eliminate.',
          },
          {
            text: 'The most reliably invisible cut is…',
            type: 'single_choice',
            options: ['A dissolve', 'A match on action', 'A cut to black', 'A jump cut'],
            correct: ['A match on action'],
            points: 2,
            explanation: 'Cutting mid-movement lets the eye follow the motion across the join, so the join itself goes unregistered.',
          },
          {
            text: 'In a dialogue scene, staying on the listener is usually…',
            type: 'single_choice',
            options: ['A mistake — cut to the speaker', 'Often stronger, because reaction is where meaning is confirmed', 'Only for comedy', 'Only possible with a master'],
            correct: ['Often stronger, because reaction is where meaning is confirmed'],
            points: 2,
            explanation: 'Cutting to whoever speaks produces a tennis match. The audience wants to watch the line land.',
          },
          {
            text: 'If a scene feels boring in the edit, the fix is usually to cut faster.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Boredom is usually a scene problem — no turn, no stakes, nothing wanted. Faster cutting disguises it briefly and never solves it.',
          },
          {
            text: 'Which are true of J and L cuts? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Sound leads the picture', 'Sound trails the picture', 'They make dialogue feel less mechanical', 'They require a dissolve'],
            correct: ['Sound leads the picture', 'Sound trails the picture', 'They make dialogue feel less mechanical'],
            points: 3,
            explanation: 'Offsetting the audio and video cut is standard in professional dialogue work. Hard-matched cuts on both feel abrupt and machine-made.',
          },
        ],
      },
      assignment: {
        title: 'Cut One Scene Two Ways',
        brief: 'From supplied or self-shot rushes, cut the same dialogue scene twice: once cutting to whoever speaks, once favouring reactions and using J/L cuts. Export both. Write 300 words on which plays better and why, referring to specific moments and timecodes.',
        rubric: 'Both cuts are complete and watchable (10) · Reaction-led version genuinely differs (10) · J/L cuts used deliberately (10) · Analysis cites specific moments (10)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
    {
      title: 'Editing II — Rhythm, Structure and the Second Rewrite',
      description: 'Restructuring, pace, montage, and knowing when a scene must go.',
      lessons: [
        {
          title: 'The Film You Shot Is Not the Film You Wrote',
          description: 'Restructuring in the edit, and killing scenes that work.',
          content: `# Post is the second rewrite

The assembly reveals what the script could not: which scenes carry weight, which repeat, which are simply slow.

**The commonest structural fix is deletion.** Scenes that work in isolation are cut because the film does not need them. If a scene can be removed and the audience is never confused, it was doing less work than its running time claimed.

**The second commonest is reordering.** Information arriving earlier or later transforms a film. Try it before arguing about it — an edit is cheap to test and expensive to debate.

**The third is starting later.** A very large proportion of first cuts begin one scene too early.

## The read-through test

Watch with someone who has not read the script. Note precisely where they disengage. Do not ask their opinion — ask what they thought was happening at minute twelve. Comprehension data beats taste.`,
          videoUrl: 'https://www.youtube.com/watch?v=T-FLqIFkfFA',
          resourceLabel: 'What "Every Frame a Painting" teaches about editing',
          minutes: 30,
        },
        {
          title: 'Pace and Rhythm',
          description: 'Pace is not speed — it is the management of expectation.',
          content: `# Fast is not the same as urgent

Pace is how quickly the audience receives new information, not how quickly you cut. A film of long takes can be relentless; a rapidly-cut one can be inert.

**Vary it deliberately.** A sustained fast passage exhausts. A sustained slow one loses. Tension is built by contrast — a held moment after a run of quick cutting lands harder than either alone.

**Give the audience somewhere to breathe** after a major beat. Comedy needs the same: a laugh needs room or the next line is lost under it.

## Montage

A montage compresses time or accumulates evidence. It fails when it does neither and simply shows pleasant things happening to music. Ask what the montage argues.

## Music in the edit

Beware cutting to temp music too early — it flatters a scene and hides structural problems. Cut it silent first. If the scene plays silent, it will soar with score. If it needs music to work, it does not yet work.`,
          videoUrl: 'https://www.youtube.com/watch?v=uWrY66MRAnM',
          minutes: 30,
        },
        {
          title: 'The Cuts: Rough, Fine, Picture Lock',
          description: 'The stages of an edit and what each one is for.',
          content: `# Stages exist so decisions stop moving

**Assembly.** Everything, in order, long.

**Rough cut.** Structure decided. Scenes may still move or go, but the film is recognisable.

**Fine cut.** Frame-level trimming. Structure is settled; only rhythm is in play.

**Picture lock.** No further picture changes. This matters enormously: sound design, music and the grade are all built against specific frames. Changing picture after lock invalidates work in three departments at once.

## Feedback discipline

Show the rough cut to few people, chosen for honesty rather than kindness, and ask specific questions. "Did you like it?" produces noise. "At what point did you know what she wanted?" produces data.

## Knowing when to stop

There is a point past which changes stop improving and merely differ. Recognising it is a professional skill, and deadlines are its most common teacher.`,
          videoUrl: 'https://www.youtube.com/watch?v=PWRRMIkCrWs',
          resourceLabel: 'Cutting a short film start to finish',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Editing II',
        description: 'Restructuring, pace and the stages of a cut.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'Why does picture lock matter so much?',
            type: 'single_choice',
            options: ['It signals the director is finished', 'Sound, music and grade are all built against specific frames', 'It is a contractual milestone', 'It allows the edit to be archived'],
            correct: ['Sound, music and grade are all built against specific frames'],
            points: 2,
            explanation: 'A picture change after lock invalidates work in three departments simultaneously. That is why the milestone is treated as genuinely binding.',
          },
          {
            text: 'The most common structural fix in the edit is…',
            type: 'single_choice',
            options: ['Adding a voiceover', 'Deleting scenes', 'Reshooting', 'Adding music'],
            correct: ['Deleting scenes'],
            points: 2,
            explanation: 'If a scene can be removed without confusing anyone, it was doing less work than its running time claimed — however well it plays on its own.',
          },
          {
            text: 'Pace is best defined as…',
            type: 'single_choice',
            options: ['How fast you cut', 'How quickly the audience receives new information', 'The average shot length', 'The tempo of the music'],
            correct: ['How quickly the audience receives new information'],
            points: 2,
            explanation: 'A film of long takes can be relentless and a rapidly-cut one inert. Cutting speed and pace are different things.',
          },
          {
            text: 'Cutting to temp music early is a good way to find a scene\'s rhythm.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Temp music flatters a scene and hides structural weakness. Cut silent first — a scene that only works with music does not yet work.',
          },
          {
            text: 'Which questions produce useful feedback on a rough cut? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['"At what point did you know what she wanted?"', '"Where did you stop paying attention?"', '"Did you like it?"', '"What did you think was happening at minute twelve?"'],
            correct: ['"At what point did you know what she wanted?"', '"Where did you stop paying attention?"', '"What did you think was happening at minute twelve?"'],
            points: 3,
            explanation: 'Comprehension and attention data are actionable. Taste — "did you like it" — produces noise you cannot edit with.',
          },
        ],
      },
      assignment: {
        title: 'Restructure Report',
        brief: 'Take your own assembly, or one supplied. Produce a restructure report: identify one scene to delete and justify it, one reorder to try and what it would change, and the point at which the film should actually start. Then implement the changes and export both versions.',
        rubric: 'Deletion is justified by function, not quality (10) · Reorder rationale is specific (10) · Start point argued convincingly (10) · Both exports delivered (10)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
    {
      title: 'Colour and Grading',
      description: 'Correction before creation: matching shots, then giving the film a look.',
      lessons: [
        {
          title: 'Correction Versus Grading',
          description: 'Two distinct jobs, done in that order.',
          content: `# Fix it, then style it

**Correction** makes the image technically right and consistent: exposure balanced, white balance neutral, shots within a scene matching one another. This is not creative — it is the floor everything else stands on.

**Grading** is the creative pass: contrast, palette, warmth, the look.

Doing them in the wrong order — styling before matching — produces a scene where every shot has the same filter and none of them match.

## The tools

**Lift, gamma, gain** — shadows, midtones, highlights. Learn these before anything else.

**Curves** for precise control. **Scopes** — waveform and vectorscope — because your eyes adapt and lie to you within seconds. Trust the scopes.

## Matching within a scene

Pick the best-exposed shot as your reference. Match every other shot in the scene to it — skin tone first, then background. The audience forgives an unusual look; it does not forgive a face changing colour across a cut.`,
          videoUrl: 'https://www.youtube.com/watch?v=QK6pAiaiXO4',
          resourceUrl: 'https://www.youtube.com/watch?v=jK_nYq4ZpgY',
          resourceLabel: 'A second grading walkthrough',
          minutes: 30,
        },
        {
          title: 'Skin Tone and African Complexions',
          description: 'Exposing and grading darker skin properly — a craft failure with a long history.',
          content: `# Getting it right

Film stock and, later, camera processing were historically calibrated for light skin, and the legacy persists in default profiles and in bad habits. Grading darker complexions well is a specific skill and it starts on set.

**On set:** expose for the face, not the average. Underexposing dark skin and lifting it in post introduces noise exactly where the audience is looking. Give the face light — bounce is your friend — and place it above the noise floor.

**In the grade:** protect saturation in the skin. A common error is desaturating globally for a "cinematic" look, which drains darker skin of life and leaves it grey. Use a qualifier to hold the skin while you treat everything else.

**Reference:** grade against skin you know is correct. The vectorscope's skin tone line is a guide, not an instruction — real complexions vary widely and the line was never intended as a target for all of them.

## Why it matters

An audience notices immediately when people who look like them are rendered badly, even when they cannot name the fault. For Nigerian cinema this is not a niche concern — it is the central one.`,
          videoUrl: 'https://www.youtube.com/watch?v=jK_nYq4ZpgY',
          minutes: 30,
        },
        {
          title: 'Building a Look, and Delivering It',
          description: 'LUTs, consistency and export.',
          content: `# A look is a decision, repeated

Decide the look early — ideally tested during pre-production, so the DOP shoots for it — and apply it consistently. A film whose look changes between scenes reads as unfinished unless the change is dramatised.

**LUTs** are a starting point, not a grade. Applying a LUT and stopping is the visual equivalent of leaving temp music in the mix.

**Consistency checks.** View the whole film in one sitting after grading. Errors that are invisible shot by shot are obvious in sequence.

## Export

Know your delivery target before you export. Cinema, broadcast and streaming all want different things, and getting it wrong means re-rendering.

- **Colour space and gamma** must match the specification.
- **Check on more than one screen** — including a phone, since a great many Nigerian viewers will watch there.
- **Keep the project and the source media.** Deliverables get revised.`,
          videoUrl: 'https://www.youtube.com/watch?v=QK6pAiaiXO4',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Colour and Grading',
        description: 'Correction, skin tone and delivery.',
        passMark: 75,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What is the correct order of work?',
            type: 'single_choice',
            options: ['Grade, then correct', 'Correct and match, then grade', 'Apply a LUT, then correct', 'They are the same process'],
            correct: ['Correct and match, then grade'],
            points: 2,
            explanation: 'Styling before matching gives every shot the same filter and none of them consistent. Correction is the floor the creative pass stands on.',
          },
          {
            text: 'Why should you trust scopes rather than your eyes?',
            type: 'single_choice',
            options: ['Scopes are more precise about colour names', 'The eye adapts within seconds and stops seeing the cast', 'Monitors are always miscalibrated', 'Scopes show the delivery format'],
            correct: ['The eye adapts within seconds and stops seeing the cast'],
            points: 2,
            explanation: 'Visual adaptation is fast and unconscious. The waveform and vectorscope do not adapt, which is exactly why they are the reference.',
          },
          {
            text: 'What is the correct approach to exposing darker skin?',
            type: 'single_choice',
            options: ['Underexpose and lift in the grade', 'Expose for the face and give it light, keeping it above the noise floor', 'Expose for the background', 'Use the camera\'s automatic average metering'],
            correct: ['Expose for the face and give it light, keeping it above the noise floor'],
            points: 2,
            explanation: 'Lifting an underexposed face introduces noise exactly where the audience is looking. The fix belongs on set, with bounce and deliberate exposure.',
          },
          {
            text: 'Global desaturation is a safe way to achieve a cinematic look.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'It drains darker complexions of life and leaves them grey. Qualify and protect the skin while treating the rest of the frame.',
          },
          {
            text: 'Before exporting, which should you check? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Colour space and gamma against the delivery spec', 'The whole film viewed in one sitting', 'Playback on a phone screen', 'The original call sheets'],
            correct: ['Colour space and gamma against the delivery spec', 'The whole film viewed in one sitting', 'Playback on a phone screen'],
            points: 3,
            explanation: 'Sequence reveals inconsistencies invisible shot by shot, and a very large share of the audience will watch on a phone. Both are real checks, not optional polish.',
          },
        ],
      },
      assignment: {
        title: 'Match and Grade a Scene',
        brief: 'Take a scene with at least four shots including at least one darker complexion. Correct and match every shot to a reference, then apply a deliberate look. Submit before/after exports, a scope screenshot of your reference shot, and 300 words on the skin-tone decisions you made.',
        rubric: 'Shots genuinely match across the scene (15) · Skin tone rendered with retained saturation and detail (15) · Look is deliberate and consistent (5) · Analysis shows scope-based reasoning (5)',
        maxScore: 40,
        dueInDays: 14,
      },
    },

    {
      title: 'Sound Design and the Mix',
      description: 'Building the film\'s sound world, and balancing it so every word lands.',
      lessons: [
        {
          title: 'The Layers of a Soundtrack',
          description: 'Dialogue, atmos, effects, foley and music — and what each is for.',
          content: `# Five layers

**Dialogue.** The priority. Everything else is arranged around intelligibility.

**Atmospheres (atmos).** The continuous bed of a place — the room, the street, the market. Atmos is what makes a location feel real and what makes cuts invisible.

**Hard effects.** Specific events: a door, a gunshot, a phone.

**Foley.** Human-scale sound performed to picture — footsteps, clothing, handling. Its absence is felt as a strange lifelessness even when nobody identifies why.

**Music.** Score and source. Source music exists in the world; score comments on it. Confusing the two disorients an audience.

## Sound tells the audience where to look

A sound that arrives fractionally before its image directs attention. Sound is also the cheapest world-building available: three well-chosen atmos layers can build a city you never shot.

## Building outward

Start with dialogue. Add atmos to make it sit in a place. Add effects for events. Add foley for life. Add music last — and only where it earns its place.`,
          videoUrl: 'https://www.youtube.com/watch?v=3u7PzHT7uS0',
          minutes: 30,
        },
        {
          title: 'Dialogue Editing and Repair',
          description: 'Making production sound work, and knowing when to give up on it.',
          content: `# Dialogue first

**Smoothing.** Fill every gap with room tone from the same location. A silent gap between lines is far more noticeable than the noise it replaced — digital silence reads as a dropout.

**Cleaning.** Noise reduction is a scalpel, not a wash. Over-processed dialogue develops a hollow, watery artefact that is worse than the noise. Take less than you think you need.

**Matching.** A scene cut from a boom take and a lav take will jump in character. Choose a primary source and treat the other to match it.

## When to accept ADR

If a line is unintelligible, or the noise is louder than the voice, or a motorbike passes through the middle — ADR. Record it early enough that the performance can be matched while the actor still remembers the scene.

## Levels

Dialogue sits in a narrow band and everything else moves around it. If the audience must strain, nothing else you did matters.`,
          videoUrl: 'https://www.youtube.com/watch?v=3u7PzHT7uS0',
          minutes: 25,
        },
        {
          title: 'The Mix and Delivery',
          description: 'Balance, dynamics and the loudness standards platforms enforce.',
          content: `# The mix is a hierarchy

At any moment, decide what the audience must hear. Everything else steps down. Beginners mix everything loud, which produces a wall in which nothing is audible.

**Dynamic range.** Cinema tolerates a wide range. A phone in a Lagos danfo does not. Mixing for a target matters — and for most Nigerian releases, the phone is the real target.

**Check on multiple systems.** Studio monitors, headphones, laptop speakers, a phone speaker. A mix that survives all four is a mix.

**Loudness.** Streaming platforms specify integrated loudness (commonly around -23 to -16 LUFS depending on the target). Deliver outside the spec and the platform will normalise your film for you — usually in a way you will not like.

## Stems

Deliver stems: dialogue, music and effects as separate mixes. Any future dub, edit or territory version depends on them. A film without stems is very expensive to revise.`,
          videoUrl: '',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Sound Design and Mix',
        description: 'Layers, dialogue repair, and delivery standards.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'Why fill gaps between lines with room tone rather than leaving them silent?',
            type: 'single_choice',
            options: ['It sounds fuller', 'Digital silence reads as a dropout and is more noticeable than the noise it replaced', 'It is required for delivery', 'It reduces file size'],
            correct: ['Digital silence reads as a dropout and is more noticeable than the noise it replaced'],
            points: 2,
            explanation: 'The ear tracks the background bed. When it vanishes entirely the audience hears a fault, even in a quiet scene.',
          },
          {
            text: 'What distinguishes source music from score?',
            type: 'single_choice',
            options: ['Source is licensed, score is composed', 'Source exists in the world of the film; score comments from outside it', 'Source is diegetic only in musicals', 'There is no meaningful difference'],
            correct: ['Source exists in the world of the film; score comments from outside it'],
            points: 2,
            explanation: 'Characters can hear source music; they cannot hear score. Blurring the two without intent disorients an audience.',
          },
          {
            text: 'What should the mix be checked on?',
            type: 'multiple_choice',
            options: ['Studio monitors', 'Headphones', 'A phone speaker', 'Only the system it will be exhibited on'],
            correct: ['Studio monitors', 'Headphones', 'A phone speaker'],
            points: 3,
            explanation: 'A great many viewers watch on a phone. A mix that only survives on monitors will fail its actual audience.',
          },
          {
            text: 'Heavier noise reduction always improves dialogue.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Over-processing produces a hollow, watery artefact that is worse than the original noise. Noise reduction is a scalpel — take less than you think you need.',
          },
          {
            text: 'Why deliver separate dialogue, music and effects stems?',
            type: 'single_choice',
            options: ['To reduce the master file size', 'Because any future dub, re-edit or territory version depends on them', 'Because platforms reject single-file mixes', 'To speed up rendering'],
            correct: ['Because any future dub, re-edit or territory version depends on them'],
            points: 2,
            explanation: 'Without stems, a foreign-language dub or a trim for a broadcaster means rebuilding the mix from scratch.',
          },
        ],
      },
      assignment: {
        title: 'Sound-Build a Scene',
        brief: 'Take a two-minute scene with production sound only. Build it: clean and smooth the dialogue with room tone, add at least two atmos layers, add hard effects and at least one foley pass. Deliver a mix plus separate D/M/E stems and state the integrated loudness of your master.',
        rubric: 'Dialogue intelligible throughout with no dropouts (15) · Atmos makes the location convincing (10) · Foley present and synchronised (5) · Stems correctly separated (5) · Loudness measured and stated (5)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
    {
      title: 'Music for Picture',
      description: 'Working with a composer, licensing, and what music can and cannot fix.',
      lessons: [
        {
          title: 'What Score Is For',
          description: 'Emotional guidance, continuity and pace — and the temptation to over-score.',
          content: `# Music makes a claim

Score tells the audience how to feel about what they are seeing. That is a large power and it is easily abused.

**It can:** bind a sequence together, carry a transition, hold tension across a slow passage, signal genre in the first ten seconds.

**It cannot:** make an audience care about a character they do not believe, or supply a turn the scene does not have. Music applied to a weak scene makes the weakness louder.

## Where NOT to score

- Under a line that carries the scene. The audience cannot listen to both.
- Under a genuine silence. Silence is an instrument and the most underused one available.
- Everywhere. A wall-to-wall score has no dynamics, so nothing can be emphasised.

## Spotting

The **spotting session** is where director, editor and composer decide exactly where music starts and stops, cue by cue, against locked picture. Do it after picture lock. Doing it earlier means composing to frames that will move.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Working With a Composer',
          description: 'Briefing, temp love, and the practicalities.',
          content: `# Briefing well

Talk about **function**, not genre: "this cue must make us doubt her" is workable; "something like Hans Zimmer" is not. Describe what the audience should feel and when the feeling should change.

## Temp love

Temp tracks are laid in by editors to test a scene. The danger is that everyone falls in love with the temp and the composer is asked to reproduce something they legally cannot. Use temp sparingly, warn the composer what is temp, and be prepared to let it go.

## Practicalities

- Agree cue lengths against locked picture.
- Agree deliverables: stems per cue, at what sample rate.
- Agree **rights** in writing. Who owns the score? What uses are licensed — festivals, streaming, territories, trailers? This is where low-budget films get stuck years later.

## Nigerian context

Local composers and session musicians are widely accessible and comparatively affordable, and there is a deep bench of players. Original score is often more achievable than licensing recognisable commercial tracks, which are frequently unaffordable or uncleared for the territories you want.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Licensing Existing Music',
          description: 'Two rights, and the mistake that costs films their release.',
          content: `# You need two licences, not one

Using an existing recording requires:

1. **The composition** (publishing) — the song itself, from the publisher.
2. **The master** (recording) — that specific recording, from the label.

Clearing one and not the other means you are not cleared. This catches filmmakers constantly.

## What a licence must state

Territory, term, media (festival? theatrical? streaming? worldwide?), and whether trailers are included. A festival-only licence will not carry a streaming release, and discovering that after a platform deal is a genuine disaster.

## Cheaper routes

- **Production libraries** — pre-cleared, single licence, variable quality.
- **Creative Commons** — free but read the terms exactly; many forbid commercial use or require attribution in a specified form.
- **Original score** — usually cheaper than it appears and always cleaner in rights.

## Never

Never cut in a commercial track you have not cleared and hope to clear it later. The negotiating position after the film is finished and the scene is built around it is the worst possible one.`,
          videoUrl: 'https://www.youtube.com/watch?v=6b_2I7zuhYU',
          resourceLabel: 'Film funding and rights — masterclass',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Music for Picture',
        description: 'Spotting, briefing and music rights.',
        passMark: 75,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'To use an existing recording in your film you must clear…',
            type: 'single_choice',
            options: ['The master recording only', 'The composition only', 'Both the composition and the master recording', 'Neither, if the film is not commercial'],
            correct: ['Both the composition and the master recording'],
            points: 3,
            explanation: 'Publishing and master are separate rights held by different parties. Clearing one and not the other means you are not cleared.',
          },
          {
            text: 'When should a spotting session happen?',
            type: 'single_choice',
            options: ['At the assembly stage', 'After picture lock', 'Before shooting', 'During the mix'],
            correct: ['After picture lock'],
            points: 2,
            explanation: 'Cues are composed to specific frames. Spotting before lock means writing music to timings that will move.',
          },
          {
            text: 'Which is a useful brief to a composer?',
            type: 'single_choice',
            options: ['"Something like Hans Zimmer."', '"This cue must make us doubt her."', '"Make it more epic."', '"Use strings."'],
            correct: ['"This cue must make us doubt her."'],
            points: 2,
            explanation: 'Brief on function — what the audience should feel and when it should change. Referencing another composer describes a texture, not a job.',
          },
          {
            text: 'Music can supply a dramatic turn that the scene itself lacks.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Score applied to a weak scene makes the weakness louder. It can guide feeling; it cannot manufacture a change that was never written or shot.',
          },
          {
            text: 'A music licence should specify which of the following? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Territory', 'Term', 'Media — festival, theatrical, streaming', 'Whether trailers are included'],
            correct: ['Territory', 'Term', 'Media — festival, theatrical, streaming', 'Whether trailers are included'],
            points: 3,
            explanation: 'All four. A festival-only licence will not carry a streaming release, and discovering that after a platform deal is a serious problem.',
          },
        ],
      },
      assignment: {
        title: 'Spotting Notes and a Rights Plan',
        brief: 'For a locked scene of at least three minutes, produce spotting notes: every cue with in and out timecodes and one line on its function. Then produce a rights plan — for each piece of music, state whether it is score, library or licensed, and exactly which rights you would need to secure.',
        rubric: 'Cue functions stated, not just placements (10) · At least one deliberate decision NOT to score (10) · Rights plan distinguishes composition from master (15) · Territory and media addressed (5)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
    {
      title: 'Titles, VFX and Finishing',
      description: 'Everything between picture lock and a file a platform will accept.',
      lessons: [
        {
          title: 'Practical Effects and Simple VFX',
          description: 'What to do in camera, and what to leave for post.',
          content: `# In camera wherever possible

Practical effects are usually cheaper, always better integrated, and immune to the post budget running out.

**Do in camera:** rain (a hose and backlight), smoke and haze, breakage with prepared props, blood, sparks with a qualified technician, and most simple wire-free stunts.

**Leave for post:** removals (a modern sign in a period street, a safety wire), screen replacements, set extensions, anything genuinely dangerous.

## Shooting for VFX

If a shot needs work later:

- **Lock the camera off** where possible, or shoot with tracking markers.
- **Shoot a clean plate** — the same frame with the subject removed. Thirty seconds on the day; hours saved in post.
- **Record the data**: lens, height, distance, and lighting positions.
- **Do not fix it in the grade first.** VFX wants the original.

## The honest budget question

A VFX shot you cannot afford to finish is a shot that will be cut. Decide before you shoot it.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Titles, Credits and Legal Obligations',
          description: 'What must appear, and where.',
          content: `# Credits are contractual

Credits are not decoration; many are legally required. Cast and crew agreements frequently specify **billing** — position, size and placement. Breaching a billing clause is a breach of contract.

**Typical requirements:** copyright notice with year and owner, financier and grant-body logos in a specified position and duration, guild or association credits where applicable, and music credits per the licence terms.

**Practical points:** titles must be legible at the size the audience actually sees them, and safe areas still matter for broadcast delivery.

## Deliverables

A finished film is a package, not a file. Typically: the master in the specified codec, an M&E (music and effects) track for dubbing, subtitle and caption files, a dialogue list, key art, and a chain-of-title document proving you own what you are selling.

Missing deliverables stall releases routinely, and the fix is always slower than doing it in order.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Mastering and Archive',
          description: 'Delivering correctly, and keeping the film alive.',
          content: `# Deliver to spec, archive properly

**Know the spec first.** Codec, resolution, frame rate, colour space, audio configuration and loudness. Every distributor and platform publishes one. Read it before you render, not after it is rejected.

**QC your own master.** Watch it end to end after export. Rendering introduces faults — dropped frames, audio drift, black frames — that were not in the timeline.

## Archive

Keep, on at least two separate physical devices in different locations:

- original camera and sound rushes,
- the project files with all media relinked,
- the graded master and the stems,
- the paperwork: releases, licences, contracts, chain of title.

Films get re-released, restored, re-cut for territories and licensed again years later. The productions that can do this are the ones that archived. The rest have a film they cannot legally or technically exploit — which is the quietest way to lose the value of everything you just made.`,
          videoUrl: '',
          minutes: 20,
        },
      ],
      quiz: {
        title: 'Quiz — Finishing and Delivery',
        description: 'VFX planning, credits obligations and mastering.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What should always be shot alongside a VFX plate?',
            type: 'single_choice',
            options: ['A wider version', 'A clean plate with the subject removed', 'A slow-motion pass', 'A second take on a longer lens'],
            correct: ['A clean plate with the subject removed'],
            points: 2,
            explanation: 'Thirty seconds on the day saves hours of reconstruction in post — and sometimes makes the shot possible at all.',
          },
          {
            text: 'Credits are…',
            type: 'single_choice',
            options: ['A courtesy to the crew', 'Frequently contractual, with billing specified by agreement', 'Decided in the edit', 'Only required for theatrical release'],
            correct: ['Frequently contractual, with billing specified by agreement'],
            points: 2,
            explanation: 'Cast and crew agreements often specify position, size and placement. Breaching a billing clause is a breach of contract.',
          },
          {
            text: 'Which belong in a delivery package? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['An M&E track', 'Subtitle and caption files', 'A chain-of-title document', 'The director\'s statement'],
            correct: ['An M&E track', 'Subtitle and caption files', 'A chain-of-title document'],
            points: 3,
            explanation: 'M&E enables dubbing, captions are usually mandatory, and chain of title proves you own what you are selling. Missing deliverables stall releases routinely.',
          },
          {
            text: 'Once a master is exported it does not need to be watched again.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Rendering introduces faults that were never in the timeline — dropped frames, audio drift, black frames. QC the master end to end.',
          },
          {
            text: 'Why archive rushes, project files, stems AND paperwork?',
            type: 'single_choice',
            options: ['Insurance requires it', 'Films are re-released, restored, re-cut and re-licensed years later', 'Platforms request it', 'For tax purposes'],
            correct: ['Films are re-released, restored, re-cut and re-licensed years later'],
            points: 2,
            explanation: 'A production that cannot produce its media and its rights paperwork has a film it can neither technically nor legally exploit again.',
          },
        ],
      },
      assignment: {
        title: 'Delivery Package',
        brief: 'Assemble a complete delivery package for a short film: master to a stated spec, M&E track, subtitle file, credits with a copyright notice, and a one-page chain-of-title summary listing every right you hold and from whom. State the spec you delivered to and confirm you QC\'d the master end to end.',
        rubric: 'Master matches a real, named spec (10) · M&E and subtitles present and correct (10) · Credits meet stated obligations (10) · Chain of title identifies every right and its source (10)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
  ],
  assessment: {
    title: 'Tier 3 Assessment — Post-Production',
    description: 'Covers editing, colour, sound, music and delivery. Pass to unlock Tier 4.',
    passMark: 75,
    timeLimitMinutes: 45,
    maxAttempts: 3,
    questions: [
      {
        text: 'A scene plays flat. Which diagnosis should you test FIRST?',
        type: 'single_choice',
        options: ['It needs music', 'It needs faster cutting', 'It has no turn, or it starts too early', 'It needs a grade'],
        correct: ['It has no turn, or it starts too early'],
        points: 3,
        explanation: 'Music, pace and grade are treatments. A scene that does not change, or that starts before the interesting moment, is a structural problem no treatment fixes.',
      },
      {
        text: 'Which must be finished before sound design and music can properly begin?',
        type: 'single_choice',
        options: ['The grade', 'Picture lock', 'The trailer', 'Subtitles'],
        correct: ['Picture lock'],
        points: 3,
        explanation: 'Sound, music and grade are all built against specific frames. Changing picture afterwards invalidates work in three departments at once.',
      },
      {
        text: 'Which are true when grading darker complexions? (Choose all that apply.)',
        type: 'multiple_choice',
        options: ['Expose for the face on set rather than lifting later', 'Protect skin saturation with a qualifier', 'Desaturate globally for a cinematic look', 'Match skin tone first when matching shots'],
        correct: ['Expose for the face on set rather than lifting later', 'Protect skin saturation with a qualifier', 'Match skin tone first when matching shots'],
        points: 4,
        explanation: 'Global desaturation drains darker skin and leaves it grey. The rest are the craft: light the face, protect it in the grade, and match skin before background.',
      },
      {
        text: 'A film delivered without stems is expensive to revise.',
        type: 'true_false',
        options: ['True', 'False'],
        correct: ['True'],
        points: 3,
        explanation: 'Any dub, territory version or re-edit needs the dialogue, music and effects separated. Without stems the mix must be rebuilt.',
      },
      {
        text: 'You have a commercial track cut into your film that you have not cleared. What is the correct action?',
        type: 'single_choice',
        options: ['Finish the film and negotiate afterwards', 'Replace it now, or clear both composition and master before building the scene around it', 'Use it for festivals only and change it later', 'Credit the artist and proceed'],
        correct: ['Replace it now, or clear both composition and master before building the scene around it'],
        points: 3,
        explanation: 'Negotiating after the film is finished and the scene depends on the track is the worst possible position — and a festival-only arrangement will not carry a streaming release.',
      },
    ],
  },
};
