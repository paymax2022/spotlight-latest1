// Tier 2 — Craft. Hands on the tools: camera, light, sound, performance, design.
import type { Tier } from './types';

export const TIER_2: Tier = {
  level: 2,
  name: 'Craft',
  summary:
    'The departments that make the image and the sound. You will finish able to expose a shot deliberately, light a face, record usable dialogue, and direct a performance in language an actor can act on.',
  modules: [
    {
      title: 'Camera I — Exposure and the Lens',
      description: 'Aperture, shutter, ISO and focal length as storytelling controls rather than technical settings.',
      lessons: [
        {
          title: 'The Exposure Triangle, and Why Only One Corner Is Free',
          description: 'Aperture, shutter and ISO — and the two that carry side effects you cannot undo.',
          content: `# Three controls, three consequences

**Aperture (f-stop)** sets how much light passes and, simultaneously, **depth of field**. Wide open (f/1.8) means a shallow plane of focus; stopped down (f/8) means much more is sharp. You are never choosing brightness alone.

**Shutter angle / speed** sets exposure time and therefore **motion blur**. The convention is 180° — shutter speed roughly double the frame rate (1/50s at 25fps). Deviating is a look: a narrow angle gives the stuttering harshness used in combat sequences; a wide one smears.

**ISO** sets sensitivity and therefore **noise**. Every sensor has a native ISO where it is cleanest. Learn yours.

## The practical order

1. Fix shutter at 180° unless you want the effect.
2. Choose aperture for the depth of field the story needs.
3. Adjust light to meet it.
4. Move ISO only when you have run out of light.

Beginners do this backwards — they leave aperture wherever it lands and chase exposure with ISO, and wonder why the image is noisy and everything is out of focus.

## Nigerian daylight

Bright exteriors present the opposite problem: too much light for a shallow stop. The answer is **ND filtration**, not stopping down to f/16 and losing the separation you wanted. An ND kit is the cheapest serious upgrade to a Nigerian exterior shoot.`,
          videoUrl: 'https://www.youtube.com/watch?v=IiyBo-qLDeM',
          minutes: 30,
        },
        {
          title: 'Focal Length and What It Does to a Face',
          description: 'Wide, normal, long — perspective as characterisation.',
          content: `# Lenses do not zoom, they interpret

Focal length changes **perspective**, not just how much fits in frame.

**Wide (18-28mm).** Exaggerates depth. Things near the lens loom; distances stretch. On a face it distorts — noses forward, ears back. Use for space, energy, unease, subjective distortion.

**Normal (35-50mm).** Roughly how we see. Neutral, unshowy, and where most drama lives.

**Long (85mm+).** Compresses depth. Backgrounds crush toward the subject; a crowd becomes a wall. Flattering on faces. Isolates a person from a place — which is a statement, not merely a look.

## The move that matters

Changing focal length while keeping the subject the same size in frame changes **the background**, not the subject. This is the real control. Want a character to feel trapped by a place? Go long and let the background press in. Want them lost in it? Go wide and let it open out.

## A drill

Shoot one actor at the same framing on 24mm, 50mm and 85mm — moving the camera to keep the head size identical. Cut them together. The face barely changes; the story changes completely.`,
          videoUrl: 'https://www.youtube.com/watch?v=5ODCB1Ez5Zs',
          minutes: 30,
        },
        {
          title: 'Focus, Format and Keeping It Sharp',
          description: 'Sensor size, the 1st AC\'s job, and why shallow focus is a liability on a fast set.',
          content: `# Shallow is not automatically better

Sensor size affects field of view and the depth of field available at a given stop. A larger sensor gives shallower focus for the same framing — which beginners chase relentlessly.

Be careful. Shallow focus on a fast schedule with a small crew and moving actors produces **soft takes you cannot use**. A slightly deeper stop is often the difference between a usable day and a heartbreaking rushes session.

## The 1st AC

Pulling focus is a discipline: marks on the floor, distances measured, the pull rehearsed. If you have no 1st AC — as many small Nigerian crews do not — then design shots that do not require a pull. That is not a compromise; it is honest planning.

## Checks before every take

- Is it in focus at the start AND the end of the move?
- Is the shutter still where you left it?
- Is white balance matched to the last setup?
- Are you recording? (Yes, really. Check.)`,
          videoUrl: 'https://www.youtube.com/watch?v=_thX0rDNu0Y',
          resourceLabel: 'StudioBinder — Steadicam and stabilised movement',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Exposure and Lenses',
        description: 'The exposure triangle, focal length and focus discipline.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'You are shooting a bright Lagos exterior and want a shallow depth of field. What is the correct tool?',
            type: 'single_choice',
            options: ['Stop down to f/16', 'Raise the shutter speed well above 180°', 'Add ND filtration', 'Lower the ISO below native'],
            correct: ['Add ND filtration'],
            points: 2,
            explanation: 'ND removes light without touching the three controls, so you keep your stop and your 180° shutter. Stopping down destroys the very separation you wanted.',
          },
          {
            text: 'Changing focal length while keeping the subject the same size in frame principally changes…',
            type: 'single_choice',
            options: ['The subject\'s sharpness', 'The background and the sense of depth', 'Exposure', 'Motion blur'],
            correct: ['The background and the sense of depth'],
            points: 2,
            explanation: 'This is the real storytelling control: long lenses compress the background onto the subject, wide lenses open it out. The face barely changes.',
          },
          {
            text: 'Which settings carry a visual side effect you cannot undo later? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Aperture — depth of field', 'Shutter angle — motion blur', 'ISO — noise', 'File name'],
            correct: ['Aperture — depth of field', 'Shutter angle — motion blur', 'ISO — noise'],
            points: 3,
            explanation: 'All three are baked into the recording. This is why exposure is a creative decision made deliberately, not a brightness problem solved by whatever is nearest.',
          },
          {
            text: 'On a fast schedule with no 1st AC, very shallow focus is a sound default.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Without a dedicated focus puller, shallow depth produces soft, unusable takes. Designing shots that do not need a pull is honest planning, not compromise.',
          },
          {
            text: 'The conventional shutter angle for natural motion is…',
            type: 'single_choice',
            options: ['90°', '180°', '270°', '360°'],
            correct: ['180°'],
            points: 2,
            explanation: 'Roughly double the frame rate — 1/50s at 25fps. Narrower gives the stuttering look of combat sequences; wider smears.',
          },
        ],
      },
      assignment: {
        title: 'The Focal Length Drill',
        brief: 'Shoot one performer at identical head size on at least three focal lengths, moving the camera rather than zooming. Cut them together with no commentary. Then write 300 words on what changed and which one you would use for a character who feels trapped, and why.',
        rubric: 'Head size genuinely matched across takes (10) · Exposure and shutter consistent (10) · Written analysis identifies the background as the variable (10)',
        maxScore: 30,
        dueInDays: 14,
      },
    },
    {
      title: 'Camera II — Movement and Blocking',
      description: 'Moving the camera and the actor so that the movement means something.',
      lessons: [
        {
          title: 'The Movements and Their Meanings',
          description: 'Pan, tilt, dolly, track, crane, handheld — and the difference a motivated move makes.',
          content: `# Movement is punctuation

**Pan / tilt.** The camera rotates on a fixed point. Cheap, quick, and it does not change perspective — the background does not shift relative to the subject.

**Dolly / track.** The camera physically travels. This *does* change perspective, which is why a dolly-in feels so different from a zoom-in: the world reorganises around the subject.

**Crane / jib.** Vertical travel. Grand, and easily overused.

**Handheld.** Human presence. Immediacy or instability, depending on how much you let it breathe.

**Steadicam / gimbal.** Travel without footsteps. Smooth movement through space — beware of using it simply because it is available.

## Motivated versus unmotivated

A **motivated** move follows something: a character stands, the camera rises. It is invisible and it serves.

An **unmotivated** move is the camera choosing to move on its own. Powerful and expensive — the audience notices, so it had better mean something.

The most common beginner error is constant unmotivated drift, which reads as restlessness and drains the moment when a real move arrives.`,
          videoUrl: 'https://www.youtube.com/watch?v=IiyBo-qLDeM',
          minutes: 30,
        },
        {
          title: 'Blocking: Directing People Through Space',
          description: 'Staging so that the camera has something to do.',
          content: `# Blocking is the first directorial act

Blocking is where the actors move and when. It is decided before coverage, because coverage serves it.

## Work in this order

1. **Let the actors walk it.** Ask them to play the scene without instruction. What they do instinctively is usually right and tells you what the scene wants.
2. **Shape it.** Adjust for meaning: who approaches whom, who turns away, who controls the space.
3. **Then place the camera.** Not before.

Directors who place the camera first end up asking actors to hit marks that contradict the scene.

## Meaning in geography

- Proximity is relationship. Watch a scene where one person keeps closing distance and the other keeps opening it.
- Height is power. Standing over a seated person is a statement.
- Thresholds — doors, gates — are decision points. Crossing one is dramatic punctuation for free.

## The economy of it

Good blocking reduces coverage. If the staging carries the change in the scene, you may need far fewer setups — which on a compressed Nigerian schedule is not merely elegant, it is the difference between finishing the day and losing a scene.`,
          videoUrl: 'https://www.youtube.com/watch?v=npHWo0Dgb28',
          minutes: 30,
        },
        {
          title: 'The Oner, and When Not To',
          description: 'Extended takes: what they buy and what they cost.',
          content: `# The long take is a trade

A oner buys **continuous time** — the audience cannot be told that time was compressed, so tension accumulates. It also buys spectacle.

It costs you: coverage, options, and the ability to fix a performance. One flubbed line at minute four and the take is gone.

## When it genuinely earns its place

- The scene's subject *is* duration — waiting, an unbroken confrontation, a journey.
- Geography matters and cutting would break it.
- The performance is stronger uninterrupted, which is true more often than schedules allow.

## When it does not

- To show off.
- On a day you cannot afford it. A oner is a rehearsal cost, not a shooting cost. If you have not budgeted the rehearsal, you have not budgeted the shot.

## Insurance

Even when committing to a oner, shoot a safety: a simpler version, or coverage of the key beats. Directors who refuse a safety are gambling with someone else's money.`,
          videoUrl: 'https://www.youtube.com/watch?v=_thX0rDNu0Y',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Movement and Blocking',
        description: 'Motivated movement, staging order and the economics of the long take.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'Why does a dolly-in feel different from a zoom-in?',
            type: 'single_choice',
            options: ['It is smoother', 'The camera travels, so perspective changes and the world reorganises', 'It is slower', 'It keeps focus better'],
            correct: ['The camera travels, so perspective changes and the world reorganises'],
            points: 2,
            explanation: 'A zoom is a change of focal length from a fixed point — the background scales uniformly. A dolly physically moves through space, which the audience reads as entering the scene.',
          },
          {
            text: 'In what order should blocking and camera placement be decided?',
            type: 'single_choice',
            options: ['Camera first, then actors to fit it', 'Simultaneously', 'Actors walk it first, then shape it, then place the camera', 'It does not matter'],
            correct: ['Actors walk it first, then shape it, then place the camera'],
            points: 2,
            explanation: 'Coverage serves blocking. Placing the camera first forces actors onto marks that contradict what the scene wants.',
          },
          {
            text: 'A oner primarily buys you…',
            type: 'single_choice',
            options: ['Shooting time', 'Continuous time, which accumulates tension', 'Better performances automatically', 'Cheaper post'],
            correct: ['Continuous time, which accumulates tension'],
            points: 2,
            explanation: 'The audience cannot be told that time was compressed. That is the real purchase — and it costs coverage, options and the ability to fix a performance.',
          },
          {
            text: 'A long take is a rehearsal cost as much as a shooting cost.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['True'],
            points: 2,
            explanation: 'The take only works if it is rehearsed to reliability. Budgeting the shot without budgeting the rehearsal is how a oner eats a day.',
          },
          {
            text: 'Which of these are MOTIVATED camera moves? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Camera rises as a character stands', 'Camera tracks alongside someone walking', 'Slow unexplained push during a static conversation', 'Pan following a thrown object'],
            correct: ['Camera rises as a character stands', 'Camera tracks alongside someone walking', 'Pan following a thrown object'],
            points: 3,
            explanation: 'The unexplained push is unmotivated — which can be powerful, but the audience notices it, so it must mean something. Constant unmotivated drift just reads as restlessness.',
          },
        ],
      },
      assignment: {
        title: 'Block a Scene Three Ways',
        brief: 'Take a two-page scene. Produce three different blocking diagrams: one where the staging carries the scene (minimal coverage), one built for conventional shot–reverse–shot, and one as a single take. For each, list the setups required and estimate the shooting time. State which you would actually shoot and why.',
        rubric: 'Diagrams are legible and specific (10) · Setup counts are realistic (10) · Time estimates defensible (10) · Choice justified on both craft and schedule grounds (10)',
        maxScore: 40,
        dueInDays: 14,
      },
    },

    {
      title: 'Lighting — Shaping Light on a Face',
      description: 'Key, fill, contrast ratio, direction and quality. The craft that most separates amateur from professional images.',
      lessons: [
        {
          title: 'Quality, Direction, Intensity, Colour',
          description: 'The four properties of any light — the whole of lighting is controlling these.',
          content: `# Four properties, nothing else

**Quality — hard or soft.** Determined by the size of the source *relative to the subject*, not its wattage. A small source makes hard, sharp-edged shadows; a large one wraps. A bedsheet in front of a lamp is a soft source. This is the single cheapest improvement available to a beginner.

**Direction.** Where it comes from. Front light flattens and forgives; side light sculpts and reveals texture; back light separates the subject from the background. Three-quarter front from slightly above is the default for a reason — it is how we expect to see faces.

**Intensity.** How much. Relative to the other sources, not absolute.

**Colour.** Its temperature, and whether it matches the other sources. Mixed colour temperature is the most common reason amateur footage looks wrong in a way people cannot name.

## Contrast ratio

The relationship between the key side and the fill side of a face. Roughly even reads as bright, safe, comic. A wide ratio — deep shadow on the fill side — reads as serious, threatening, interior. You are choosing genre with this dial.

## Working method

Turn everything off. Add the key. Look. Add fill only if you need it. Add back light or background separation last. Beginners switch everything on at once and then cannot diagnose what any of it is doing.`,
          videoUrl: 'https://www.youtube.com/watch?v=RSsl3lUK9uU',
          resourceUrl: 'https://www.youtube.com/watch?v=2SVesm1p8Bg',
          resourceLabel: 'Three-point lighting — a second walkthrough',
          minutes: 35,
        },
        {
          title: 'Three-Point Lighting and When to Break It',
          description: 'The default setup, and why most good films do not use it literally.',
          content: `# The default, and its limits

**Key** — the main source, establishing direction and contrast. **Fill** — opposite the key, lifting shadow, setting the ratio. **Back / rim** — behind the subject, separating them from the background.

Learn it because it teaches the relationships. Then notice that most films you admire do not use it literally: they use a **motivated** source — a window, a lamp, a doorway — and shape from there.

## Motivated lighting

Ask where the light in this room comes from *in the story*, then build that and cheat it toward flattering. The audience never analyses it, but they feel the difference between a lit room and a room with lights in it.

## Negative fill

Often the useful move is to *remove* light, not add it. Black cloth on the fill side deepens the shadow and sculpts the face with no power draw at all. On a small Nigerian exterior shoot with abundant sun, negative fill and bounce will get you further than any fixture you can afford.`,
          videoUrl: 'https://www.youtube.com/watch?v=j_Sov3xmgwg',
          minutes: 30,
        },
        {
          title: 'Practical Lighting on a Small Budget',
          description: 'Bounce, diffusion, available light and matching for continuity.',
          content: `# What to buy first

Before any fixture: **a bounce board** (white poly or foam), **diffusion** (a frame with cloth), and **black cloth** for negative fill. These three shape light you already have and cost almost nothing.

## Working with sun

Direct tropical sun is a hard source directly overhead — the worst possible key for a face. Options: shoot in open shade and bounce sun in as key; diffuse overhead with a frame; or schedule for the hour after sunrise and before sunset, when the sun is low and doing your work for you.

## Matching for continuity

A scene shot over three hours will drift as the sun moves. Note where your key came from and at what ratio. If the light has moved, either re-establish it or accept that the cut will fight you.

## The discipline

Photograph every setup on your phone before you strike it. It takes four seconds and it is how you match a pickup two weeks later.`,
          videoUrl: 'https://www.youtube.com/watch?v=2SVesm1p8Bg',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Lighting',
        description: 'The four properties, contrast ratio and small-budget shaping.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What determines whether a light is hard or soft?',
            type: 'single_choice',
            options: ['Its wattage', 'Its size relative to the subject', 'Its colour temperature', 'Its distance alone'],
            correct: ['Its size relative to the subject'],
            points: 2,
            explanation: 'A large source wraps and softens; a small one produces sharp-edged shadows. This is why a bedsheet in front of a lamp is the cheapest quality upgrade available.',
          },
          {
            text: 'Which dial are you effectively turning when you set the contrast ratio on a face?',
            type: 'single_choice',
            options: ['Exposure', 'Genre and tone', 'Colour temperature', 'Depth of field'],
            correct: ['Genre and tone'],
            points: 2,
            explanation: 'Near-even ratios read bright and comic; wide ratios read serious and threatening. The audience receives it as tone, not as a technical setting.',
          },
          {
            text: 'What is the correct order for building a lighting setup?',
            type: 'single_choice',
            options: ['Everything on, then subtract', 'Key, then fill if needed, then separation', 'Back light first', 'Fill first to set the base'],
            correct: ['Key, then fill if needed, then separation'],
            points: 2,
            explanation: 'Adding one source at a time is what makes the setup diagnosable. Switching everything on at once leaves you unable to tell what any fixture is doing.',
          },
          {
            text: 'Negative fill adds light to the shadow side of a face.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'It removes light — black cloth absorbs spill and deepens the shadow, sculpting the face with no power draw. Often the useful move is subtraction.',
          },
          {
            text: 'Which are sound approaches to a bright tropical exterior? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Shoot in open shade and bounce sun in as key', 'Diffuse the overhead sun with a frame', 'Use direct overhead midday sun as the key on a face', 'Schedule for the hour after sunrise or before sunset'],
            correct: ['Shoot in open shade and bounce sun in as key', 'Diffuse the overhead sun with a frame', 'Schedule for the hour after sunrise or before sunset'],
            points: 3,
            explanation: 'Direct overhead sun is a hard source from the worst possible angle for a face — deep eye sockets, harsh nose shadow. Every other option shapes it into something usable.',
          },
        ],
      },
      assignment: {
        title: 'One Face, Four Ratios',
        brief: 'Light the same performer four ways: flat (near 1:1), a moderate ratio, a wide dramatic ratio, and one lit only by a motivated practical source. Use bounce, diffusion and negative fill rather than more fixtures. Submit stills plus a lighting diagram for each and a paragraph on what genre each suggests.',
        rubric: 'Ratios genuinely distinct and measurable (15) · Diagrams accurate to the stills (10) · Motivated setup reads as a real source (10) · Analysis connects ratio to tone (5)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
    {
      title: 'Production Sound',
      description: 'Recording dialogue you can actually use. The department most often sacrificed and least recoverable in post.',
      lessons: [
        {
          title: 'Why Sound Is the Least Forgiving Department',
          description: 'What can and cannot be repaired after the fact.',
          content: `# You can regrade a picture; you cannot un-echo a room

Audiences forgive a soft image far longer than they forgive dialogue they must strain to hear. Bad sound reads as *cheap* in a way that no other single failure does.

And it is the least repairable. A wrong lens can be reshot. A muddy grade can be regraded. But reverberation, traffic, a generator hum under a whispered line — these are baked into the recording. ADR exists, but it costs money, takes performance quality with it, and is rarely as good.

## What "usable" means

- The dialogue is clearly intelligible.
- The room tone is consistent across the scene so cuts do not jump.
- Levels peak safely below clipping, with headroom.
- There is **thirty seconds of clean room tone** recorded at every location. Every time. This single habit saves more scenes in post than any other.

## The mixer's veto

A production sound mixer who says "that take had a motorbike through the middle of it" is doing their job. A director who overrules that routinely will discover the cost in post, at ten times the price.`,
          videoUrl: 'https://www.youtube.com/watch?v=3u7PzHT7uS0',
          minutes: 25,
        },
        {
          title: 'Microphones, Placement and the Boom',
          description: 'Getting the mic close, and what happens when you cannot.',
          content: `# Proximity beats equipment

The single biggest determinant of dialogue quality is **how close the microphone is**. A modest mic close to the mouth beats an expensive one across the room, every time. Distance brings in the room, and the room is what ruins dialogue.

**Shotgun on a boom.** The default for dialogue. Boomed from above, angled down at the mouth, just out of frame. From above rather than below because it points the mic's rejection at the floor and ceiling reflections.

**Lavalier.** Clipped to clothing, hidden. Consistent level, immune to boom shadow — but vulnerable to clothing rustle and it has a flatter, closer character.

**Both.** Record boom and lav on separate tracks where you can. They are different problems and give post a choice.

## Boom operating

The boom operator watches the frame line and the shadow. Two things to internalise: the mic follows *whoever is speaking*, and the operator must know the shot size before the take — because the frame line is the whole constraint.

## Room sound

Listen to the room before you commit to it. Clap once. If it rings, you are going to fight it all day. Soft furnishings, blankets and closed windows are sound department equipment.`,
          videoUrl: 'https://www.youtube.com/watch?v=QtMH7PtOoyA',
          resourceUrl: 'https://www.youtube.com/watch?v=bBF1Rk5CtTs',
          resourceLabel: 'Professional boom operating technique',
          minutes: 30,
        },
        {
          title: 'Levels, Sync and Deliverables',
          description: 'Recording safely and handing over something post can use.',
          content: `# Getting it to post intact

**Levels.** Aim for dialogue peaks around -12 to -6 dBFS. Digital clipping is unrecoverable — there is nothing above zero. Leave headroom for the shout you did not expect.

**Sync.** A clapperboard gives the editor a visual and audio reference to align on. Timecode sync is better where available. If you have neither, clap in frame at the head of every take — it costs a second and saves an assistant editor a day.

**Naming.** Scene and take announced on every slate, verbally. Files named consistently. An unnamed card is a post problem waiting.

**Sound report.** What was recorded, which takes were flagged, what the wild tracks are. Post cannot read your mind three weeks later.

## Wild tracks

Record separately: room tone at every location, any specific effects (a door in that house, that gate, those market voices), and wild lines when a take is performance-good but sound-bad. Ten minutes on the day; hours saved later.`,
          videoUrl: 'https://www.youtube.com/watch?v=n6LqibtC-5g',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Production Sound',
        description: 'Proximity, room tone, levels and sync.',
        passMark: 75,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'The single biggest determinant of dialogue quality is…',
            type: 'single_choice',
            options: ['The price of the microphone', 'How close the microphone is to the speaker', 'The recorder\'s bit depth', 'The camera\'s preamp'],
            correct: ['How close the microphone is to the speaker'],
            points: 2,
            explanation: 'Distance brings in the room, and the room is what ruins dialogue. A modest mic close beats an expensive one far away, every time.',
          },
          {
            text: 'How much clean room tone should be recorded at every location?',
            type: 'single_choice',
            options: ['None — it is added in post', 'About five seconds', 'About thirty seconds', 'Only if the room is noisy'],
            correct: ['About thirty seconds'],
            points: 2,
            explanation: 'Room tone is what lets an editor smooth cuts and patch gaps so the background does not jump. This one habit rescues more scenes than any other.',
          },
          {
            text: 'Why is a boom normally operated from above rather than below?',
            type: 'single_choice',
            options: ['It is easier to hold', 'It points the microphone\'s rejection at floor and ceiling reflections', 'It avoids the actor\'s eyeline', 'It is required for lavaliers'],
            correct: ['It points the microphone\'s rejection at floor and ceiling reflections'],
            points: 2,
            explanation: 'Booming down at the mouth uses the mic\'s pattern to reject the reflective surfaces around it. Booming from below picks up far more room and floor noise.',
          },
          {
            text: 'Digital audio that clips can be recovered by lowering the level in post.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'There is nothing above zero in digital — the waveform is truncated and the information is gone. Hence recording with headroom, around -12 to -6 dBFS.',
          },
          {
            text: 'Which should be recorded as wild tracks? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Room tone at each location', 'Specific effects from the actual location', 'Wild lines when performance was good but sound was not', 'The director\'s notes'],
            correct: ['Room tone at each location', 'Specific effects from the actual location', 'Wild lines when performance was good but sound was not'],
            points: 3,
            explanation: 'Ten minutes of wild tracks on the day saves hours in post and preserves the authentic sound of the real place, which library effects never match.',
          },
        ],
      },
      assignment: {
        title: 'Record a Scene Twice',
        brief: 'Record the same two-minute dialogue scene twice: once with the mic deliberately far (camera-mounted or across the room), once boomed close. Include thirty seconds of room tone. Submit both audio files, a sound report, and 300 words on the difference — describing what you hear, not what you expected to hear.',
        rubric: 'Close recording is genuinely intelligible (15) · Room tone present and clean (10) · Levels peak safely with headroom (10) · Sound report is complete enough for an editor (5)',
        maxScore: 40,
        dueInDays: 14,
      },
    },

    {
      title: 'Directing Actors',
      description: 'Casting, rehearsal and the language that changes a performance instead of describing one.',
      lessons: [
        {
          title: 'Casting Is Most of Directing',
          description: 'What to look for, and what you cannot fix later.',
          content: `# The decision you cannot undo

Directors routinely say casting is 80% of the job. What they mean is that no amount of direction converts a wrong actor into a right one.

## What to look for in the room

- **Can they take an adjustment?** Give a direction and watch whether the second read genuinely changes. An actor who repeats their prepared version is telling you something important.
- **Are they listening?** Read them with a partner. Screen acting is reacting; an actor performing at you rather than with you will be exhausting to cut.
- **Do they do less than you expected?** Screen tolerates far less than stage. The actor who underplays usually cuts better.

## What not to cast for

Not for likeability. Not for the reading that was best *today* — for the one you can direct across twelve days.

## The chemistry read

For any relationship at the centre of the film, read the pair together. Chemistry is not a quality of either performer; it exists between them, and you cannot infer it from separate auditions.`,
          videoUrl: 'https://www.youtube.com/watch?v=cztKU_N3dy0',
          minutes: 25,
        },
        {
          title: 'Direction That Is Playable',
          description: 'Verbs, tactics and adjustments — replacing result-direction with action-direction.',
          content: `# Give a verb, not an adjective

**Result direction** names an outcome: "be sadder", "more menacing", "with more energy". The actor now has to guess a route, and usually performs the *appearance* of the adjective. This is where wooden acting comes from — often from the direction, not the actor.

**Action direction** names something to do to the other person: *to plead*, *to dismiss*, *to test*, *to shame*, *to protect*. It is immediately playable and produces behaviour rather than indication.

## The adjustment

The most useful directorial tool is a small change between takes:

- change the **tactic** ("this time, try convincing her it was her idea")
- change the **stake** ("play it as though he will leave if this goes wrong")
- change the **relationship** ("she is the only person who has ever believed you")

Each produces a genuinely different take rather than a louder one.

## Talking privately, and briefly

Give notes to each actor quietly, not as a public announcement, and give **one** note at a time. Three notes at once produces a careful, dead take.`,
          videoUrl: 'https://www.youtube.com/watch?v=npHWo0Dgb28',
          minutes: 30,
        },
        {
          title: 'Rehearsal and the Shooting Day',
          description: 'What to rehearse, what to protect, and how to run takes.',
          content: `# Rehearse the shape, protect the discovery

Rehearse blocking, logistics and the shape of the scene. Do **not** rehearse the emotional peak into exhaustion — some discovery must be left for the take.

## On the day

**The first take is not a warm-up.** It is often the freshest and sometimes the best. Roll it properly.

**Protect the actor's first go at the hardest moment.** Make sure sound, camera and focus are genuinely ready before you ask for it.

**Know when you have it.** Directors lose good performances by shooting past them looking for a better one that never comes. When you have it, print it and move — the schedule is a creative instrument.

## Coverage and performance

Shoot the wide early while energy is high; save the close-up for when the actor has found it. And remember that the close-up is where you will actually cut — protect it in the schedule rather than leaving it to the last twenty minutes of the day.`,
          videoUrl: 'https://www.youtube.com/watch?v=cztKU_N3dy0',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Directing Actors',
        description: 'Casting, playable direction and running the day.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'Which is action direction rather than result direction?',
            type: 'single_choice',
            options: ['"Be more menacing."', '"Try convincing her it was her idea."', '"With more energy."', '"Play it sadder."'],
            correct: ['"Try convincing her it was her idea."'],
            points: 2,
            explanation: 'It names something to do to the other person. Result direction names an outcome and leaves the actor to indicate it, which is where wooden performances come from.',
          },
          {
            text: 'In an audition, the most important thing to test is…',
            type: 'single_choice',
            options: ['Whether they memorised the sides', 'Whether they can take an adjustment and genuinely change', 'Their showreel quality', 'Their likeability'],
            correct: ['Whether they can take an adjustment and genuinely change'],
            points: 2,
            explanation: 'You are not casting the best reading today; you are casting someone you can direct across twelve days. An actor who repeats their prepared version has told you something.',
          },
          {
            text: 'How many notes should you give an actor at once?',
            type: 'single_choice',
            options: ['As many as apply', 'Three', 'One', 'None — let them work'],
            correct: ['One'],
            points: 2,
            explanation: 'Multiple simultaneous notes produce a careful, self-monitoring, dead take. One note at a time, given privately.',
          },
          {
            text: 'Chemistry between two leads can be reliably assessed from separate auditions.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'Chemistry is not a property of either performer — it exists between them. Any central relationship needs a chemistry read with both in the room.',
          },
          {
            text: 'Which are sound practices on the shooting floor? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Roll the first take properly rather than treating it as a warm-up', 'Ensure everything is ready before the actor\'s first attempt at the hardest beat', 'Keep shooting past a good take to be safe', 'Protect the close-up in the schedule'],
            correct: ['Roll the first take properly rather than treating it as a warm-up', 'Ensure everything is ready before the actor\'s first attempt at the hardest beat', 'Protect the close-up in the schedule'],
            points: 3,
            explanation: 'Shooting past a good performance loses it. Recognising that you have it and moving on is a creative decision, not merely a scheduling one.',
          },
        ],
      },
      assignment: {
        title: 'Three Adjustments',
        brief: 'Direct one actor through the same short speech four times: a neutral first pass, then three takes each driven by a different adjustment (a tactic change, a stakes change, a relationship change). Submit the footage and a note stating the exact words you used for each adjustment. You are graded on the direction, not the performance.',
        rubric: 'Adjustments are action-based, not adjectives (15) · The three takes are genuinely different (10) · One note at a time (5) · Written record matches what is on camera (10)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
    {
      title: 'Production Design, Costume and the Frame',
      description: 'Building the world inside the frame — and doing it on a Nigerian indie budget.',
      lessons: [
        {
          title: 'What Production Design Actually Decides',
          description: 'Beyond sets and props: colour, texture, class, time and truth.',
          content: `# Design is characterisation

Production design answers: what does this world look like, and what does that tell us? Every object in frame is either saying something or wasting space.

**Colour.** A restricted palette reads as controlled and designed; an unrestricted one reads as documentary or as accident. Choose deliberately.

**Texture and wear.** New objects say new money or no history. Worn objects say time. This is where low budgets often win — real, worn Nigerian locations carry a density of history that a built set struggles to fake.

**Class and specificity.** The difference between "an office" and "a mid-level civil servant's office in Ikeja that has not been refurbished since 2009" is the difference between a set and a world.

**Continuity.** Design owns what is where. Photograph every set before the first take.

## The practical hierarchy on a small budget

1. What is behind the actor's head in the close-up. This is 80% of what the audience sees.
2. What the actor touches.
3. Everything else.

Spend your money in that order.`,
          videoUrl: 'https://www.youtube.com/watch?v=83hYhbknuJc',
          resourceUrl: 'https://www.youtube.com/watch?v=xZLlScsaX30',
          resourceLabel: 'A production designer on the work itself',
          minutes: 30,
        },
        {
          title: 'Costume, Hair and Make-up',
          description: 'Character through clothing, and the continuity burden it creates.',
          content: `# Clothes are decisions the character made

Costume is not "what people wear" — it is what this person chose to put on this morning, and what that says about who they think they are.

Ask of every costume: who bought it, when, and why is it being worn today? A character in a shirt slightly too good for their circumstances tells a story before a line is spoken.

## Practical constraints

- **Doubles.** Anything that might get dirty, wet or torn needs a duplicate. This is a budget line people forget until the day.
- **Camera behaviour.** Fine stripes and tight patterns can shimmer on a sensor. Pure white blows out; pure black loses detail. Test on camera, not in the room.
- **Sound.** Stiff synthetic fabrics rustle over a lavalier. The sound mixer should see the costumes before the shoot day.

## Continuity

Photograph every character at the start of every scene: full length, front and back. On a schedule shooting out of order, these photographs are the only reliable record of which sleeve was rolled up.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'Locations: Finding, Assessing, Securing',
          description: 'The recce, and the questions that must be asked before you commit.',
          content: `# A location is a production decision

**The recce checklist** — go with this list, every time:

- **Sound.** Stand still and listen for two full minutes. Traffic? Generator? A church or mosque nearby with fixed times? Aircraft path? Clap once for reverberation.
- **Power.** Is there any? Whose is it? What happens when it fails — and it will.
- **Light.** Where is the sun at your shooting hours? Which windows, facing where? Go at the time of day you will shoot.
- **Access.** Can equipment get in? Stairs? A lift that fits a light stand?
- **Space.** Can the camera get far enough back for your widest shot?
- **Toilets, shade, water.** Crew welfare is a scheduling fact.
- **Permission.** Who actually owns it, and is that the person you are negotiating with?

## Securing it

Get it in writing, including dates, hours and what happens if you overrun. Community locations need the community informed, not just the landlord paid — Nollywood's access to real places runs on goodwill, and one badly-behaved production spoils a street for everyone.`,
          videoUrl: '',
          minutes: 25,
        },
      ],
      quiz: {
        title: 'Quiz — Design, Costume and Locations',
        description: 'Where design money goes, costume continuity and the recce.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'On a tight budget, where should design money go first?',
            type: 'single_choice',
            options: ['The widest establishing shot', 'What is behind the actor\'s head in the close-up', 'Costume for background artists', 'Set dressing at the edges of frame'],
            correct: ['What is behind the actor\'s head in the close-up'],
            points: 2,
            explanation: 'The close-up background is most of what the audience actually looks at. Spend there first, on what the actor touches second, everything else last.',
          },
          {
            text: 'Why should the sound mixer see the costumes before the shoot day?',
            type: 'single_choice',
            options: ['To match colours to the set', 'Because stiff synthetic fabrics rustle over a lavalier', 'To check continuity', 'For insurance purposes'],
            correct: ['Because stiff synthetic fabrics rustle over a lavalier'],
            points: 2,
            explanation: 'Costume is a sound problem as much as a visual one. Discovering it on the day means either a compromised recording or a costume change nobody planned.',
          },
          {
            text: 'What should you do first on a location recce?',
            type: 'single_choice',
            options: ['Photograph the space', 'Stand still and listen for two full minutes', 'Measure the room', 'Check the power supply'],
            correct: ['Stand still and listen for two full minutes'],
            points: 2,
            explanation: 'Sound is the least recoverable problem, and the one most easily missed when you are looking at how a room photographs. Listen before you look.',
          },
          {
            text: 'A location recce should be done at the time of day you intend to shoot.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['True'],
            points: 2,
            explanation: 'Sun position, traffic, neighbourhood noise and available power all change through the day. A morning recce tells you very little about an afternoon shoot.',
          },
          {
            text: 'Which costume items reliably need doubles? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Anything that gets wet in the story', 'Anything that gets torn or bloodied', 'A jacket worn in a single clean interior scene', 'Anything worn during a stunt'],
            correct: ['Anything that gets wet in the story', 'Anything that gets torn or bloodied', 'Anything worn during a stunt'],
            points: 3,
            explanation: 'Doubles are needed wherever a take changes the garment irreversibly. It is a budget line that is invisible until the second take is impossible.',
          },
        ],
      },
      assignment: {
        title: 'Recce Report and Design Brief',
        brief: 'Recce a real location at your intended shooting hour. Produce a report covering sound, power, light, access, space, welfare and permission. Then write a one-page design brief for one scene there: palette, three key objects behind the actor in close-up, and the costume decision for your lead with a sentence on what it says about them.',
        rubric: 'Recce covers all seven areas with specifics (15) · Sound assessed honestly (10) · Design brief connects choices to character (10) · Palette is restricted and justified (5)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
    {
      title: 'Continuity and Script Supervision',
      description: 'The record that makes an out-of-order shoot assemble into a film.',
      lessons: [
        {
          title: 'What the Script Supervisor Owns',
          description: 'Continuity, coverage tracking and the editor\'s lifeline.',
          content: `# The memory of the production

Shooting out of order means nobody can hold the film in their head. The script supervisor is the record.

**Continuity.** What was where, worn how, held in which hand, at what point in the dialogue. Cigarettes, drinks, injuries and hairstyles are the classic offenders.

**Coverage tracking.** Which lines are covered by which setup — the **lined script**. This tells the editor exactly which angles exist for any moment, and tells the director on the floor whether the scene is actually complete.

**Screen direction and eyeline.** Tracking the line so it is not crossed by accident.

**Take notes.** Which takes the director liked and why. The single most valuable document handed to post.

## On a small crew

Many Nigerian indie productions run without a script supervisor. Someone must still do it. If nobody is assigned, the job is being done badly by everybody, and it surfaces in the edit as scenes that will not cut.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'The Lined Script and Take Notes',
          description: 'How to produce records post can actually use.',
          content: `# Two documents

**The lined script.** A vertical line down the page for each setup, running through the dialogue it covers — solid where the actor is on camera, wavy where they are off. At a glance the editor sees every option for every line.

**The take log.** Per take: scene, slate, take number, duration, a one-word verdict (print / hold / NG) and a short reason. "T3 — print, best turn on 'you promised'" is worth more in the edit than any amount of remembering.

## The completeness check

Before the AD calls a scene wrapped, the supervisor answers one question: **is every line covered from at least one usable angle?** If not, say so now. Discovering a hole in the edit means a reshoot, and a reshoot means the location, the cast and the light again.

## Matching action

When an action crosses a cut — standing, opening a door, handing something over — it must be performed at a matching speed and hand in every angle. The supervisor calls this before the take, not after.`,
          videoUrl: '',
          minutes: 25,
        },
        {
          title: 'The Continuity Habits That Actually Work',
          description: 'Cheap discipline that prevents expensive problems.',
          content: `# Four habits

1. **Photograph everything.** Every actor at the top of every scene, every set before the first take, every lighting setup. Your phone is the department's most valuable tool.
2. **Note the hand.** Which hand holds the glass, which shoulder the bag is on. Reversals are the most-noticed continuity error because the audience reads them as a jump.
3. **Track consumables.** How full was the glass, how far down the cigarette, how much food on the plate. Assign someone to reset these between takes.
4. **Write it down at the time.** Not later. There is no later.

## Perspective

Not every error matters. An audience gripped by a scene will not notice a shifted cup — and stopping a good take to correct one is often the worse trade. Judgement is: does this error break the *cut*, or merely the *record*? Errors that break the cut are worth stopping for. The rest can be logged and lived with.`,
          videoUrl: '',
          minutes: 20,
        },
      ],
      quiz: {
        title: 'Quiz — Continuity and Script Supervision',
        description: 'The lined script, take notes and continuity judgement.',
        passMark: 70,
        timeLimitMinutes: 15,
        maxAttempts: 3,
        questions: [
          {
            text: 'What does a lined script tell the editor?',
            type: 'single_choice',
            options: ['Which takes were printed', 'Which setups cover which lines, and whether the actor is on or off camera', 'The shooting order', 'The intended cut'],
            correct: ['Which setups cover which lines, and whether the actor is on or off camera'],
            points: 2,
            explanation: 'It is a map of the options that exist for every moment of the scene — and on the floor, it is how you know whether a scene is genuinely complete.',
          },
          {
            text: 'Before a scene is wrapped, the essential question is…',
            type: 'single_choice',
            options: ['Did we get enough takes?', 'Is every line covered from at least one usable angle?', 'Are the actors happy?', 'Did we stay on schedule?'],
            correct: ['Is every line covered from at least one usable angle?'],
            points: 2,
            explanation: 'A hole discovered in the edit means a reshoot — location, cast and light all over again. That question, asked on the floor, is the cheapest insurance available.',
          },
          {
            text: 'A continuity error is always worth stopping a good take to correct.',
            type: 'true_false',
            options: ['True', 'False'],
            correct: ['False'],
            points: 2,
            explanation: 'The judgement is whether the error breaks the CUT or merely the record. A shifted cup in a gripping scene goes unnoticed; interrupting a strong performance is the worse trade.',
          },
          {
            text: 'Which continuity error do audiences notice most readily?',
            type: 'single_choice',
            options: ['A slightly different fill level in a glass', 'An object switching hands across a cut', 'A cushion moved two inches', 'A background extra changing position'],
            correct: ['An object switching hands across a cut'],
            points: 2,
            explanation: 'Reversals read as a jump because the eye tracks the moving object. Level and dressing errors sit below the threshold of attention.',
          },
          {
            text: 'What belongs in a take log? (Choose all that apply.)',
            type: 'multiple_choice',
            options: ['Scene and take number', 'A verdict — print, hold or NG', 'A short reason for the verdict', 'The lens serial number'],
            correct: ['Scene and take number', 'A verdict — print, hold or NG', 'A short reason for the verdict'],
            points: 3,
            explanation: 'The reason is what makes the log valuable weeks later — "best turn on \'you promised\'" tells an editor something no take number can.',
          },
        ],
      },
      assignment: {
        title: 'Line a Scene and Log the Takes',
        brief: 'Using footage you shoot or footage supplied by your tutor, produce a lined script for one scene and a complete take log. Then write a short note identifying any line NOT covered from a usable angle, and what you would shoot to close the gap.',
        rubric: 'Lined script correctly shows on- and off-camera coverage (15) · Take log includes verdicts with reasons (10) · Coverage gaps correctly identified (10) · Proposed pickup is realistic (5)',
        maxScore: 40,
        dueInDays: 14,
      },
    },
  ],
  assessment: {
    title: 'Tier 2 Assessment — Craft',
    description: 'Covers camera, lighting, sound, performance, design and continuity. Pass to unlock Tier 3.',
    passMark: 75,
    timeLimitMinutes: 45,
    maxAttempts: 3,
    questions: [
      {
        text: 'Which failure is LEAST recoverable in post?',
        type: 'single_choice',
        options: ['A slightly soft image', 'A flat, uncorrected grade', 'Dialogue recorded in a reverberant room with traffic', 'An uneven edit rhythm'],
        correct: ['Dialogue recorded in a reverberant room with traffic'],
        points: 3,
        explanation: 'Grade and rhythm are authored in post; softness can sometimes be lived with. Reverberation and traffic are baked into the recording, and ADR costs money and performance.',
      },
      {
        text: 'You have one hour, one actor and daylight. Which gets you closest to a professional image?',
        type: 'single_choice',
        options: ['A larger fixture', 'Open shade with bounce as key and black cloth for negative fill', 'A wider lens', 'A higher frame rate'],
        correct: ['Open shade with bounce as key and black cloth for negative fill'],
        points: 3,
        explanation: 'Shaping the light you already have — direction, quality and ratio — beats adding fixtures. Bounce, diffusion and negative fill are the cheapest serious upgrade available.',
      },
      {
        text: 'Which of these are decided BEFORE camera placement? (Choose all that apply.)',
        type: 'multiple_choice',
        options: ['Blocking', 'What the scene is for', 'Lens choice', 'The turn in the scene'],
        correct: ['Blocking', 'What the scene is for', 'The turn in the scene'],
        points: 4,
        explanation: 'Coverage serves the staging, which serves the scene\'s purpose. Lens is a consequence of those decisions, not a starting point.',
      },
      {
        text: 'An actor is giving you the same take repeatedly. The most useful next move is to give an adjustment rather than an adjective.',
        type: 'true_false',
        options: ['True', 'False'],
        correct: ['True'],
        points: 3,
        explanation: 'Changing the tactic, the stake or the relationship produces genuinely different behaviour. "More energy" produces a louder version of the same take.',
      },
      {
        text: 'Your 1st AC is unavailable and you are shooting a moving two-hander. What is the responsible response?',
        type: 'single_choice',
        options: ['Shoot wide open and accept some soft takes', 'Design shots that do not require a focus pull', 'Shoot more takes', 'Switch to a longer lens'],
        correct: ['Design shots that do not require a focus pull'],
        points: 3,
        explanation: 'Without a focus puller, shallow depth on moving actors produces unusable takes. A deeper stop and a shot design that avoids pulls is honest planning.',
      },
    ],
  },
};
