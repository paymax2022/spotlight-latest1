// ── Naija Driver quiz — stage bank mock (dev / offline) ──────────────────────
// Derived from docs/prd/driver contest/naija_driver_quiz_seed.json (the real
// 90-question bank: 3 stages × 30, 120s per question). To keep the bundle small
// we inline ~10 questions per stage — the exact seed SHAPE — so every screen is
// fully walkable offline in USE_MOCK mode.
//
// IMPORTANT (contestant-safe contract): each entry here carries `answerIndex` +
// `explanation` so the MOCK scorer can build the `perQuestion` reveal exactly
// like the backend does on submit. The question-FEED accessors below STRIP those
// fields, so the client only ever holds answers for questions it has scored —
// matching the real backend, which never ships answers on a feed (and never in
// exam mode). Option ids are the string indices "0".."3" per the contract.

import type {
  PlayAlongQuestion,
  PlayAlongStageSet,
  PlayAlongPerQuestion,
  QuizStage,
  ExamAssignment,
  TheoryBatch,
} from './types';
import { PER_QUESTION_SECS, stageMeta } from './constants';

/** A seed-shaped row: the full answer key lives here (server-side analogue). */
interface SeedQuestion {
  id: string;
  category: string;
  question: string;
  options: [string, string, string, string];
  answerIndex: 0 | 1 | 2 | 3;
  explanation: string;
  /** Optional illustration — 'sign:<key>' renders a bundled road-sign SVG. */
  imageUrl?: string;
}

const SEED: Record<QuizStage, SeedQuestion[]> = {
  1: [
    {
      id: 'ND-S1-Q01', category: 'road_signs',
      question: "In Nigeria, what shape are most warning signs (e.g. 'bend ahead', 'narrow bridge')?",
      options: ['Rectangular', 'Triangular', 'Circular', 'Octagonal'], answerIndex: 1,
      explanation: 'Triangular signs warn of hazards ahead. Circular signs give orders; rectangular signs give information.',
    },
    {
      id: 'ND-S1-Q02', category: 'road_signs',
      question: 'A circular road sign with a red border generally means:',
      options: ['Information for drivers', 'A warning of danger ahead', 'Parking is permitted', 'Prohibition — something is not allowed'], answerIndex: 3,
      explanation: "Red-bordered circles are prohibitive/regulatory signs, e.g. 'No entry', 'No overtaking'.",
    },
    {
      id: 'ND-S1-Q03', category: 'traffic_rules',
      question: 'What must you do at a red traffic light?',
      options: ['Stop only if pedestrians are crossing', 'Slow down and proceed if clear', 'Sound your horn and proceed', 'Stop completely behind the stop line'], answerIndex: 3,
      explanation: 'Red means a complete stop behind the stop line until the light turns green.',
    },
    {
      id: 'ND-S1-Q05', category: 'traffic_rules',
      question: "Which agency is primarily responsible for road traffic safety and driver's licensing in Nigeria?",
      options: ['NAFDAC', 'FRSC (Federal Road Safety Corps)', 'NDLEA', 'EFCC'], answerIndex: 1,
      explanation: "The FRSC administers road safety, driver's licences and highway regulations in Nigeria.",
    },
    // ── Sign-identification questions (render a bundled road-sign SVG) ──
    {
      id: 'ND-S1-SIGN01', category: 'road_signs', imageUrl: 'sign:no-overtaking',
      question: 'What does this sign mean?',
      options: ['No overtaking', 'No entry', 'One-way traffic', 'End of speed limit'], answerIndex: 0,
      explanation: 'A red circle showing two cars means overtaking is prohibited on this stretch of road.',
    },
    {
      id: 'ND-S1-SIGN02', category: 'road_signs', imageUrl: 'sign:give-way',
      question: 'What must you do when you see this sign?',
      options: ['Stop completely at all times', 'Give way to traffic on the major road', 'Sound your horn and proceed', 'Increase your speed'], answerIndex: 1,
      explanation: 'The inverted red triangle means give way — yield to traffic on the road you are joining.',
    },
    {
      id: 'ND-S1-SIGN03', category: 'road_signs', imageUrl: 'sign:roundabout-ahead',
      question: 'This warning sign tells you there is a … ahead.',
      options: ['Sharp bend', 'Roundabout', 'Level crossing', 'Steep hill'], answerIndex: 1,
      explanation: 'The triangular sign with three curved arrows warns of a roundabout ahead — slow down and give way.',
    },
    {
      id: 'ND-S1-SIGN04', category: 'road_signs', imageUrl: 'sign:pedestrian-crossing',
      question: 'What hazard does this sign warn of?',
      options: ['Children playing', 'A pedestrian crossing ahead', 'Road works', 'Slippery road'], answerIndex: 1,
      explanation: 'The triangle showing a person on a crossing warns of a pedestrian crossing ahead — be ready to stop.',
    },
    {
      id: 'ND-S1-SIGN05', category: 'road_signs', imageUrl: 'sign:no-entry',
      question: 'What does this sign mean?',
      options: ['No entry for vehicular traffic', 'Stop', 'No parking', 'Give way'], answerIndex: 0,
      explanation: 'A solid red circle with a white horizontal bar means no entry — do not proceed past this point.',
    },
    {
      id: 'ND-S1-Q06', category: 'emergency_response',
      question: 'What is the FRSC national toll-free emergency number?',
      options: ['767', '122', '199', '911'], answerIndex: 1,
      explanation: 'Dial 122 (toll-free) to reach the FRSC in a road emergency or crash.',
    },
    {
      id: 'ND-S1-Q08', category: 'traffic_rules',
      question: 'In Nigeria, vehicles are driven on which side of the road?',
      options: ['Either side', 'The left side', 'The right side', 'The centre of the road'], answerIndex: 2,
      explanation: 'Nigeria uses right-hand traffic: keep right, and overtaking is normally done on the left.',
    },
    {
      id: 'ND-S1-Q10', category: 'road_signs',
      question: 'A red octagonal (eight-sided) sign always means:',
      options: ['STOP', 'No parking', 'Give way', 'Danger ahead'], answerIndex: 0,
      explanation: 'The octagon is reserved for STOP: come to a complete halt before proceeding.',
    },
    {
      id: 'ND-S1-Q19', category: 'road_signs',
      question: 'A continuous (unbroken) white line in the centre of the road means:',
      options: ['It marks a bus lane', 'It marks a parking zone', 'Overtaking is allowed at any time', 'Do not cross or overtake across the line'], answerIndex: 3,
      explanation: 'A solid centre line prohibits crossing or overtaking because visibility or conditions are unsafe.',
    },
    {
      id: 'ND-S1-Q21', category: 'speed_limits',
      question: 'The general speed limit for cars in built-up areas (towns and cities) in Nigeria is:',
      options: ['50 km/h', '100 km/h', '30 km/h', '80 km/h'], answerIndex: 0,
      explanation: 'In built-up areas the limit for cars is 50 km/h due to pedestrians, junctions and heavy activity.',
    },
    {
      id: 'ND-S1-Q23', category: 'safe_practice',
      question: 'Seat belts must be worn by:',
      options: ['The driver only', 'Only on expressways', 'The driver and all passengers', 'Front-seat occupants only'], answerIndex: 2,
      explanation: 'Nigerian law requires the driver and all passengers to use seat belts on every trip.',
    },
  ],
  2: [
    {
      id: 'ND-S2-Q01', category: 'safe_practice',
      question: "The 'two-second rule' is used to:",
      options: ['Time traffic lights', 'Keep a safe following distance from the vehicle ahead', 'Calculate fuel consumption', 'Measure engine speed'], answerIndex: 1,
      explanation: 'Pick a fixed point; if you pass it less than two seconds after the car ahead, you are too close.',
    },
    {
      id: 'ND-S2-Q02', category: 'night_weather',
      question: 'On wet roads or in rain, your following distance should be:',
      options: ['The same as in dry weather', 'Ignored because of the wipers', 'Reduced to stay in convoy', 'At least doubled — about four seconds'], answerIndex: 3,
      explanation: 'Wet roads can double stopping distances, so double your gap to at least four seconds.',
    },
    {
      id: 'ND-S2-Q03', category: 'overtaking',
      question: 'In Nigeria (right-hand traffic), you should normally overtake other vehicles on the:',
      options: ['Left side', 'Either side freely', 'Right side', 'Road shoulder'], answerIndex: 0,
      explanation: 'With traffic keeping right, overtaking is done on the left, returning right when safely clear.',
    },
    {
      id: 'ND-S2-Q05', category: 'speed_limits',
      question: 'The maximum speed limit for private cars on Nigerian expressways is:',
      options: ['140 km/h', '100 km/h', '80 km/h', '120 km/h'], answerIndex: 1,
      explanation: 'Cars are limited to 100 km/h on expressways (80 km/h on other highways, 50 km/h in town).',
    },
    {
      id: 'ND-S2-Q06', category: 'safe_practice',
      question: 'The legal blood alcohol concentration (BAC) limit for drivers in Nigeria is:',
      options: ['0.00% — but only for learners', '0.50%', '0.10%', '0.05%'], answerIndex: 3,
      explanation: 'FRSC enforces a 0.05 g/100ml BAC limit; the safest choice is not to drink at all before driving.',
    },
    {
      id: 'ND-S2-Q07', category: 'safe_practice',
      question: 'Using a handheld mobile phone while driving is:',
      options: ['Allowed for business calls', 'A punishable traffic offence', 'Allowed if the call is short', 'Allowed in slow traffic'], answerIndex: 1,
      explanation: 'Phone use while driving is an FRSC offence — it multiplies your crash risk. Park safely to make calls.',
    },
    {
      id: 'ND-S2-Q11', category: 'safe_practice',
      question: 'The correct routine before changing lanes is:',
      options: ['Signal only, then move', 'Horn, then swerve', 'Mirror — Signal — check blind spot — then Manoeuvre', 'Brake, turn, then signal'], answerIndex: 2,
      explanation: 'The MSM routine with a blind-spot (shoulder) check prevents side-swipe collisions.',
    },
    {
      id: 'ND-S2-Q20', category: 'traffic_rules',
      question: 'When entering a roundabout, you should give way to:',
      options: ['Only trucks and tankers', 'Nobody — first come, first served', 'Vehicles behind you', 'Traffic already circulating in the roundabout'], answerIndex: 3,
      explanation: 'Vehicles already in the roundabout have priority; enter only when there is a safe gap.',
    },
    {
      id: 'ND-S2-Q23', category: 'safe_practice',
      question: 'If you begin to feel sleepy while driving, the safest action is to:',
      options: ['Stop in a safe place and rest', 'Drive faster to finish the trip quickly', 'Turn up the music loudly', 'Open the window and continue'], answerIndex: 0,
      explanation: 'No trick beats sleep. A short nap in a safe place can save your life — fatigue kills.',
    },
    {
      id: 'ND-S2-Q29', category: 'safe_practice',
      question: 'Wearing a seat belt in a crash roughly:',
      options: ['Only helps below 30 km/h', 'Halves your risk of death or serious injury', 'Doubles your risk of injury', 'Makes no measurable difference'], answerIndex: 1,
      explanation: 'Belts cut the risk of death for front-seat occupants by about 45–50% — buckle up every trip.',
    },
  ],
  3: [
    {
      id: 'ND-S3-Q01', category: 'emergency_response',
      question: 'If your brakes fail while driving, you should first:',
      options: ['Accelerate to escape the traffic around you', 'Switch off the engine and remove the key', 'Jump out of the moving vehicle', 'Pump the brake pedal, shift to a lower gear and apply the handbrake gradually'], answerIndex: 3,
      explanation: 'Pumping may restore pressure; engine braking and gradual handbrake use scrub off speed under control.',
    },
    {
      id: 'ND-S3-Q02', category: 'emergency_response',
      question: 'If a tyre bursts at speed, you should:',
      options: ['Grip the steering firmly, ease off the accelerator and slow down gradually', 'Swerve quickly to the shoulder at speed', 'Switch off the ignition at once', 'Brake as hard as possible immediately'], answerIndex: 0,
      explanation: 'Hard braking or sharp steering after a blowout causes loss of control — decelerate smoothly first.',
    },
    {
      id: 'ND-S3-Q03', category: 'hazard_perception',
      question: "'Aquaplaning' (hydroplaning) happens when:",
      options: ['Tyres lose contact with the road on a film of water', 'The road surface is dusty', 'The wipers stop working', 'The engine floods with fuel'], answerIndex: 0,
      explanation: 'At speed on standing water, tyres ride on the water film and steering and braking stop working.',
    },
    {
      id: 'ND-S3-Q06', category: 'emergency_response',
      question: 'On a highway, the warning triangle (C-caution) should be placed approximately:',
      options: ['200 metres ahead of the vehicle', '45 metres behind the vehicle', '5 metres behind the vehicle', 'On the roof of the vehicle'], answerIndex: 1,
      explanation: 'About 45 m gives approaching traffic time to see and react before reaching your vehicle.',
    },
    {
      id: 'ND-S3-Q07', category: 'emergency_response',
      question: 'To correct a rear-wheel skid, you should:',
      options: ['Accelerate hard out of it', 'Pull the handbrake firmly', 'Ease off the pedals and steer gently in the direction the rear is sliding', 'Brake hard and steer away from the skid'], answerIndex: 2,
      explanation: 'Steering into the skid realigns the car; harsh braking or power makes the slide worse.',
    },
    {
      id: 'ND-S3-Q11', category: 'emergency_response',
      question: 'Arriving first at a crash scene, your first action should be to:',
      options: ['Start moving all victims immediately', 'Take photographs before anything else', 'Drive past quickly to avoid delay', 'Park safely, switch on hazard lights, protect the scene and call 122'], answerIndex: 3,
      explanation: 'Securing the scene prevents a second crash; then summon FRSC/emergency services on 122.',
    },
    {
      id: 'ND-S3-Q12', category: 'emergency_response',
      question: 'A crash victim with a suspected neck or spinal injury should be:',
      options: ["Carried on someone's back to a car", 'Given water to drink', 'Left in position and not moved unless there is immediate danger such as fire', 'Sat upright immediately to help breathing'], answerIndex: 2,
      explanation: 'Movement can turn a spinal injury into permanent paralysis — wait for trained responders unless danger forces evacuation.',
    },
    {
      id: 'ND-S3-Q14', category: 'hazard_perception',
      question: 'If you double your speed, your braking distance becomes roughly:',
      options: ['Half as long', 'Twice as long', 'Exactly the same', 'Four times as long'], answerIndex: 3,
      explanation: 'Braking distance rises with the square of speed — small speed increases cost big stopping distance.',
    },
    {
      id: 'ND-S3-Q21', category: 'emergency_response',
      question: 'In an emergency stop with ABS brakes, you should:',
      options: ['Pump the pedal rapidly', 'Release the brake when the pedal vibrates', 'Press the brake firmly, keep it pressed, and steer around the hazard if needed', 'Use only the handbrake'], answerIndex: 2,
      explanation: 'The pulsing pedal is ABS working — maintain firm pressure; ABS lets you steer while braking.',
    },
    {
      id: 'ND-S3-Q29', category: 'hazard_perception',
      question: "Brief 'microsleeps' while driving are a sign of:",
      options: ['Low fuel level', 'The air-conditioner being too strong', 'Good, relaxed concentration', 'Dangerous fatigue — stop and rest immediately'], answerIndex: 3,
      explanation: 'A 3-second microsleep at 100 km/h means over 80 metres travelled blind.',
    },
  ],
};

/** Build a contestant-safe question (strips answer + explanation). */
function toSafeQuestion(s: SeedQuestion): PlayAlongQuestion {
  return {
    id: s.id,
    category: s.category,
    prompt: s.question,
    imageUrl: s.imageUrl,
    options: s.options.map((label, i) => ({ id: String(i), label })),
    timeLimitSecs: PER_QUESTION_SECS,
  };
}

function clampStage(stage: number): QuizStage {
  return (stage === 2 ? 2 : stage === 3 ? 3 : 1) as QuizStage;
}

/** GET …/playalong/questions?stage=N (contestant-safe stage set). */
export function mockPlayAlongStage(stage: number): PlayAlongStageSet {
  const s = clampStage(stage);
  const meta = stageMeta(s);
  return {
    stageNumber: s,
    stageName: meta.name,
    passMarkPercent: meta.passMarkPercent,
    timeLimitSecs: PER_QUESTION_SECS,
    questions: SEED[s].map(toSafeQuestion),
  };
}

/**
 * Local scorer for USE_MOCK submit — mirrors the backend attempt result exactly:
 * a score/total/passed plus the `perQuestion` reveal (correct option +
 * explanation). Unanswered questions score 0 (per the seed's scoring note).
 */
export function mockScorePlayAlong(
  stage: number,
  answers: { questionId: string; optionId: string }[],
): {
  score: number;
  total: number;
  passed: boolean;
  perQuestion: PlayAlongPerQuestion[];
  credentialIssued: boolean;
  credentialHash: string | null;
  cashbackKobo: number | null;
} {
  const s = clampStage(stage);
  const bank = SEED[s];
  const picked = new Map(answers.map((a) => [a.questionId, a.optionId]));

  const perQuestion: PlayAlongPerQuestion[] = bank.map((q) => {
    const correctOptionId = String(q.answerIndex);
    const chosen = picked.get(q.id);
    return {
      questionId: q.id,
      correctOptionId,
      explanation: q.explanation,
      correct: chosen === correctOptionId,
    };
  });

  const total = bank.length;
  const score = perQuestion.filter((p) => p.correct).length;
  const pct = total > 0 ? (score / total) * 100 : 0;
  const passed = pct >= stageMeta(s).passMarkPercent;

  // Small ledgered promotional cashback on a pass (disclosure applies).
  const cashbackKobo = passed ? 20_000 : null; // ₦200
  const credentialIssued = passed;
  const credentialHash = passed
    ? `csd_${s}_${Math.abs(hashString(answers.map((a) => a.questionId + a.optionId).join('|'))).toString(16)}`
    : null;

  return { score, total, passed, perQuestion, credentialIssued, credentialHash, cashbackKobo };
}

// ─── Proctored exam mock (C6) ────────────────────────────────────────────────
// The exam draws from stage 3 of the same bank (the hardest tier). Contestant-
// safe: NO answers leave this module for the exam path (never revealed, never
// scored client-side — the backend signs the Merit entry).

const MOCK_EXAM_BATCH: TheoryBatch = 'B1';
const MOCK_EXAM_STAGE: QuizStage = 3;

export function mockExamAssignment(): ExamAssignment {
  return {
    batch: MOCK_EXAM_BATCH,
    stage: MOCK_EXAM_STAGE,
    timeLimitSecs: PER_QUESTION_SECS,
    questions: SEED[MOCK_EXAM_STAGE].map(toSafeQuestion),
  };
}

/** Deterministic string hash for mock credential ids. */
function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return h;
}
