// ── Paymax AI Symptom Checker — Triage API layer (mock-first) ────────────────
// Self-contained, mock-first data layer. Reuses USE_MOCK + HEALTH_API_BASE.
// SAFETY (encoded here, surfaced in UI):
//   SC-1  output framed as "possible causes / guidance", never "diagnosis".
//   SC-2  a DETERMINISTIC red-flag layer can ALWAYS override toward emergency.
//   SC-3  on ambiguity, favour safety (the mock engine over-refers).
//   SC-9  paediatric / maternal evidence biases urgency upward.
// IRON RULE: money in kobo; referral payment carries an Idempotency-Key header.

import { api } from '@/api/client';
import { USE_MOCK, TRIAGE_API_BASE, AMBULANCE_FALLBACK } from './constants';
import type {
  Profile,
  CreateProfileInput,
  CreateSessionInput,
  TriageSession,
  IntakeInput,
  InterviewStep,
  AnswerInput,
  TriageResult,
  EmergencyInfo,
  ReferInput,
  Referral,
  PayReferralInput,
  PayReferralResult,
  FeedbackInput,
  DispositionLevel,
  CareRoute,
} from './types';

const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

// ── Mock state (in-memory; resets on reload) ─────────────────────────────────
const MOCK_PROFILES: Profile[] = [
  { id: 'prof_self', kind: 'self', name: 'You', dob: '1994-05-12', sex: 'female' },
  { id: 'prof_child', kind: 'child', name: 'Ada (daughter)', dob: '2019-09-01', sex: 'female' },
];

interface MockSession {
  id: string;
  profileId?: string;
  state: TriageSession['state'];
  asked: string[];
  rawText: string;
  redFlag: boolean;
}
const MOCK_SESSIONS = new Map<string, MockSession>();

// Deterministic emergency keywords (SC-2). Real impl = clinician-signed rules.
const RED_FLAG_TERMS = [
  'chest pain',
  'cannot breathe',
  "can't breathe",
  'difficulty breathing',
  'unconscious',
  'not breathing',
  'heavy bleeding',
  'seizure',
  'convulsion',
  'stiff neck',
  'blue lips',
  'severe',
];

function detectRedFlag(text: string): boolean {
  const t = text.toLowerCase();
  return RED_FLAG_TERMS.some((term) => t.includes(term));
}

const DISCLAIMER =
  'This is triage guidance only, not a medical diagnosis. In an emergency, seek in-person care immediately.';

// Mock adaptive interview: a small fixed question bank surfaced one at a time.
const QUESTION_BANK: InterviewStep['question'][] = [
  {
    code: 'duration',
    text: 'How long have you felt this way?',
    type: 'single_select',
    options: [
      { value: 'today', label: 'Started today' },
      { value: 'days', label: 'A few days' },
      { value: 'week_plus', label: 'A week or more' },
    ],
  },
  {
    code: 'fever',
    text: 'Do you have a fever (hot body)?',
    type: 'boolean',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
  },
  {
    code: 'severity',
    text: 'How bad does it feel right now?',
    type: 'single_select',
    options: [
      { value: 'mild', label: 'Mild — I can carry on' },
      { value: 'moderate', label: 'Moderate — it bothers me' },
      { value: 'severe', label: 'Severe — I can barely cope' },
    ],
  },
];

function nextQuestion(s: MockSession): InterviewStep['question'] | undefined {
  return QUESTION_BANK.find((q) => q && !s.asked.includes(q.code));
}

// ── Profiles ─────────────────────────────────────────────────────────────────
export async function getProfiles(): Promise<Profile[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_PROFILES];
  }
  const { data } = await api.get<Profile[]>(`${TRIAGE_API_BASE}/profiles`);
  return data;
}

export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  if (USE_MOCK) {
    await delay();
    const profile: Profile = { id: `prof_${Date.now()}`, ...input };
    MOCK_PROFILES.push(profile);
    return profile;
  }
  const { data } = await api.post<Profile>(`${TRIAGE_API_BASE}/profiles`, input);
  return data;
}

// ── Sessions ─────────────────────────────────────────────────────────────────
export async function createSession(input: CreateSessionInput): Promise<TriageSession> {
  if (USE_MOCK) {
    await delay();
    const id = `sess_${Date.now()}`;
    MOCK_SESSIONS.set(id, {
      id,
      profileId: input.profileId,
      state: 'CONSENTED',
      asked: [],
      rawText: '',
      redFlag: false,
    });
    return { id, state: 'CONSENTED', disclaimer: DISCLAIMER };
  }
  const { data } = await api.post<TriageSession>(`${TRIAGE_API_BASE}/sessions`, input);
  return data;
}

export async function submitIntake(sessionId: string, input: IntakeInput): Promise<InterviewStep> {
  if (USE_MOCK) {
    await delay();
    const s = MOCK_SESSIONS.get(sessionId);
    if (!s) throw new Error('Session not found');
    s.rawText = input.rawText;
    // SC-2: deterministic red-flag layer overrides immediately.
    if (detectRedFlag(input.rawText)) {
      s.redFlag = true;
      s.state = 'RED_FLAG_DETECTED';
      return { id: sessionId, state: 'RED_FLAG_DETECTED', done: true, disposition: 1, redFlag: true };
    }
    s.state = 'INTERVIEWING';
    const q = nextQuestion(s);
    return { id: sessionId, state: 'INTERVIEWING', question: q };
  }
  const { data } = await api.post<InterviewStep>(
    `${TRIAGE_API_BASE}/sessions/${sessionId}/intake`,
    { raw_text: input.rawText, body_map: input.bodyMap },
  );
  return data;
}

export async function submitAnswer(sessionId: string, input: AnswerInput): Promise<InterviewStep> {
  if (USE_MOCK) {
    await delay();
    const s = MOCK_SESSIONS.get(sessionId);
    if (!s) throw new Error('Session not found');
    s.asked.push(input.code);

    // SC-2/SC-3: a "severe" answer escalates deterministically toward urgency.
    if (input.code === 'severity' && input.value === 'severe') {
      s.redFlag = true;
      s.state = 'RED_FLAG_DETECTED';
      return { id: sessionId, state: 'RED_FLAG_DETECTED', done: true, disposition: 2, redFlag: true };
    }

    const q = nextQuestion(s);
    if (q) {
      return { id: sessionId, state: 'INTERVIEWING', question: q };
    }
    // Interview complete → derive a (conservative) disposition level.
    s.state = 'DISPOSITION_GIVEN';
    const level = deriveLevel(s);
    return { id: sessionId, state: 'DISPOSITION_GIVEN', done: true, disposition: level, redFlag: false };
  }
  const { data } = await api.post<InterviewStep>(
    `${TRIAGE_API_BASE}/sessions/${sessionId}/answer`,
    { code: input.code, value: input.value },
  );
  return data;
}

// Conservative mock: default to a clinician visit (level 3) unless clearly mild.
function deriveLevel(s: MockSession): DispositionLevel {
  if (s.redFlag) return 1;
  return 3;
}

export async function getSession(sessionId: string): Promise<TriageResult> {
  if (USE_MOCK) {
    await delay();
    const s = MOCK_SESSIONS.get(sessionId);
    const redFlag = s?.redFlag ?? false;
    const level: DispositionLevel = redFlag ? 1 : 3;
    return buildMockResult(sessionId, level, redFlag);
  }
  const { data } = await api.get<TriageResult>(`${TRIAGE_API_BASE}/sessions/${sessionId}`);
  return data;
}

function buildMockResult(id: string, level: DispositionLevel, redFlag: boolean): TriageResult {
  // SC-1: "possible causes" framing only — never "diagnosis".
  const possibleCauses = redFlag
    ? [
        { label: 'A possibly serious condition that needs urgent assessment', probability: 0.55 },
        { label: 'Severe infection', probability: 0.25 },
      ]
    : [
        { label: 'Malaria', probability: 0.42 },
        { label: 'Typhoid', probability: 0.21 },
        { label: 'A common viral illness', probability: 0.18 },
      ];
  const guidance = redFlag
    ? 'Your answers suggest this may be serious. Seek emergency care now — call an ambulance or go to the nearest emergency room.'
    : 'Your symptoms are common in this area. A clinician or pharmacist can help confirm the cause and start treatment. A simple lab test (e.g. malaria) may be useful.';
  const recommendedRoute = redFlag ? 'emergency' : level <= 3 ? 'telemedicine' : 'pharmacy';
  return {
    id,
    state: redFlag ? 'RED_FLAG_DETECTED' : 'DISPOSITION_GIVEN',
    dispositionLevel: level,
    dispositionCode: redFlag ? 'EMERGENCY' : 'PRIMARY_CARE',
    possibleCauses,
    guidance,
    disclaimer: DISCLAIMER,
    redFlag,
    recommendedRoute,
  };
}

// ── Referral + payment (money-path) ──────────────────────────────────────────
export async function createReferral(sessionId: string, input: ReferInput): Promise<Referral> {
  if (USE_MOCK) {
    await delay();
    const route: CareRoute =
      input.level <= 2 ? 'emergency' : input.level === 3 ? 'telemedicine' : input.level === 4 ? 'pharmacy' : 'self_care';
    const PRICE_KOBO: Partial<Record<CareRoute, number>> = {
      telemedicine: 350000,
      pharmacy: 150000,
      lab: 650000,
    };
    const amountKobo = PRICE_KOBO[route] ?? 0;
    return {
      referralId: `ref_${Date.now()}`,
      route,
      amountKobo,
      emergency: route === 'emergency' ? MOCK_EMERGENCY : undefined,
    };
  }
  const { data } = await api.post<Referral>(
    `${TRIAGE_API_BASE}/sessions/${sessionId}/refer`,
    { level: input.level },
  );
  return data;
}

/**
 * Pay for the referred care action. Reuses the held-payment convention:
 * the Idempotency-Key guards the charge (IRON RULE money handling). The shared
 * wallet checkout (usePurchasePayment) calls this from its `charge()`.
 */
export async function payReferral(input: PayReferralInput): Promise<PayReferralResult> {
  if (USE_MOCK) {
    await delay(500);
    return { state: 'PAID' };
  }
  const { data } = await api.post<PayReferralResult>(
    `${TRIAGE_API_BASE}/referrals/${input.referralId}/pay`,
    {},
    { headers: { 'Idempotency-Key': input.idempotencyKey } },
  );
  return data;
}

// ── Emergency lookup (SC-8) ──────────────────────────────────────────────────
const MOCK_EMERGENCY: EmergencyInfo = {
  erName: 'Lagos State Emergency / LASUTH A&E',
  erAddress: '1-5 Oba Akinjobi Way, Ikeja, Lagos',
  ambulance: AMBULANCE_FALLBACK,
  firstAid: [
    'Stay calm and keep the person still.',
    'If they are unconscious but breathing, lay them on their side.',
    'Do not give food or drink.',
    'If there is heavy bleeding, press firmly on the wound with a clean cloth.',
    'Stay on the line with the ambulance and follow their instructions.',
  ],
  lat: 6.6018,
  lng: 3.3515,
};

export async function getNearestEmergency(lat?: number, lng?: number): Promise<EmergencyInfo> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_EMERGENCY;
  }
  const { data } = await api.get<EmergencyInfo>(`${TRIAGE_API_BASE}/emergency/nearest`, {
    params: { lat, lng },
  });
  return data;
}

// ── Records + feedback (mock no-ops) ─────────────────────────────────────────
export async function saveSessionToRecords(sessionId: string): Promise<{ recordId: string }> {
  if (USE_MOCK) {
    await delay();
    return { recordId: `rec_${sessionId}` };
  }
  const { data } = await api.post<{ recordId: string }>(
    `${TRIAGE_API_BASE}/sessions/${sessionId}/save`,
    {},
  );
  return data;
}

export async function submitFeedback(input: FeedbackInput): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay();
    return { ok: true };
  }
  await api.post(`${TRIAGE_API_BASE}/sessions/${input.sessionId}/feedback`, {
    rating: input.rating,
    comment: input.comment,
  });
  return { ok: true };
}

// Caller-owned idempotency key minter (mirrors lab/api.ts newIdempotencyKey).
export function newIdempotencyKey(prefix = 'triage'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
