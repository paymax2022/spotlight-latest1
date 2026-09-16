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
  ProfileKind,
  Sex,
  CreateProfileInput,
  CreateSessionInput,
  TriageSession,
  SessionState,
  IntakeInput,
  InterviewStep,
  TriageQuestion,
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

// ── Backend wire shapes (raw JSON as returned by Go) ──────────────────────────
// Every route wraps its payload as {success, <key>: ...} (never a bare body),
// keys are snake_case (Go's json tags), and several structures don't match the
// app's domain types at all — a nested Disposition object instead of flat
// fields, options as bare strings instead of {value,label}, first-aid as one
// paragraph instead of a step list. These interfaces + the map* functions below
// are the ONLY place that reshapes the wire response into the domain types
// used by the rest of the app (see backend/internal/health/triage/{core,care}).
interface GoProfile {
  id: string;
  user_id: string;
  kind: string;
  name?: string;
  dob?: string;
  sex?: string;
  is_pregnant: boolean;
  created_at: string;
}
interface GoSession {
  id: string;
  user_id: string;
  profile_id?: string;
  state: string;
  language: string;
  channel: string;
  disposition_level?: number;
  disposition_code?: string;
  red_flag: boolean;
  started_at: string;
  created_at: string;
}
interface GoDisposition {
  level: number;
  code: string;
  route: string;
  red_flag: boolean;
  guidance: string;
}
interface GoQuestion {
  code: string;
  text: string;
  options?: string[];
}
interface GoPossibleCause {
  label: string;
  probability: number;
}
interface GoSessionView {
  session: GoSession;
  possible_causes: GoPossibleCause[];
  disposition?: GoDisposition;
  next_question?: GoQuestion;
  disclaimer: string;
}
interface GoEmergencyInfo {
  facility_name: string;
  facility_address: string;
  distance_m: number;
  ambulance_number: string;
  first_aid: string;
}
interface GoCareReferral {
  id: string;
  session_id: string;
  user_id: string;
  disposition_level: number;
  route: string;
  target_ref?: string;
  state: string;
  amount_minor: number;
  payment_ref?: string;
  created_at: string;
  updated_at: string;
}
interface GoReferResult {
  referral: GoCareReferral;
  emergency?: GoEmergencyInfo;
}

// Go's SessionState strings ("red_flag_detected", "disposition_given", …) are
// the same spelling as the app's SessionState union, just lower_snake instead
// of UPPER_SNAKE — a plain uppercase is the correct (and only) mapping.
function mapSessionState(s: string): SessionState {
  return s.toUpperCase() as SessionState;
}

// Go's CareReferral/Disposition route values use "telemed"; the app's
// CareRoute union + CARE_ROUTE_META key off "telemedicine". Every other value
// (emergency/pharmacy/lab/self_care) lines up 1:1.
function mapCareRoute(route: string): CareRoute {
  return route === 'telemed' ? 'telemedicine' : (route as CareRoute);
}

function mapProfile(p: GoProfile): Profile {
  return {
    id: p.id,
    kind: p.kind as ProfileKind,
    name: p.name ?? '',
    dob: p.dob ?? '',
    sex: (p.sex as Sex) ?? 'female',
    isPregnant: p.is_pregnant,
  };
}

function mapEmergencyInfo(e: GoEmergencyInfo): EmergencyInfo {
  return {
    erName: e.facility_name,
    erAddress: e.facility_address,
    // Go returns the bare dial digits (NigeriaAmbulanceNumber = "112"); the app
    // always treats `ambulance` as a tel: URI (emergency.tsx Linking.openURL).
    ambulance: e.ambulance_number.startsWith('tel:') ? e.ambulance_number : `tel:${e.ambulance_number}`,
    // Go returns one first-aid paragraph, not a step list — wrap it so
    // data.firstAid.map(...) in emergency.tsx still renders correctly.
    firstAid: e.first_aid ? [e.first_aid] : [],
    // Go's care.EmergencyInfo carries no coordinates; emergency.tsx already
    // falls back to an address-only maps query when lat/lng are absent.
  };
}

function mapQuestion(q: GoQuestion): TriageQuestion {
  // Go's Question carries no `type` and options are bare strings, not
  // {value,label} pairs. The engine never signals multi-select today, so every
  // live question is presented single_select — interview.tsx's toggle() then
  // always takes the single-value branch, matching Answer's `value: string`
  // Go bind (a JSON array there would fail ShouldBindJSON with a 400).
  const opts = q.options ?? [];
  return {
    code: q.code,
    text: q.text,
    type: 'single_select',
    options: opts.map((v) => ({ value: v, label: v })),
  };
}

function mapInterviewStep(view: GoSessionView): InterviewStep {
  return {
    id: view.session.id,
    state: mapSessionState(view.session.state),
    question: view.next_question ? mapQuestion(view.next_question) : undefined,
    // SubmitIntake/Answer only ever return with next_question XOR disposition
    // set (core/service.go's runEngineLoop) — absence of a next question means
    // the engine (or the red-flag layer) has finalised a disposition.
    done: !view.next_question,
    disposition: view.disposition?.level as DispositionLevel | undefined,
    redFlag: view.disposition?.red_flag ?? view.session.red_flag,
  };
}

function mapTriageResult(view: GoSessionView): TriageResult {
  if (!view.disposition) {
    // GetSession is only ever called once the interview loop has finalised a
    // disposition (result.tsx via useSession) — no disposition means the
    // session isn't actually done yet, which is a caller bug, not a value to
    // paper over with a guessed urgency level (SC-3 fail-safe applies to
    // engine output, not to missing data).
    throw new Error('triage: session has no disposition yet');
  }
  const d = view.disposition;
  return {
    id: view.session.id,
    state: mapSessionState(view.session.state),
    dispositionLevel: d.level as DispositionLevel,
    dispositionCode: d.code,
    possibleCauses: view.possible_causes.map((c) => ({ label: c.label, probability: c.probability })),
    guidance: d.guidance,
    disclaimer: view.disclaimer,
    redFlag: d.red_flag,
    recommendedRoute: mapCareRoute(d.route),
  };
}

function mapReferral(res: GoReferResult): Referral {
  return {
    referralId: res.referral.id,
    route: mapCareRoute(res.referral.route),
    amountKobo: res.referral.amount_minor,
    emergency: res.emergency ? mapEmergencyInfo(res.emergency) : undefined,
  };
}

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
  // Backend wraps every response as {success, <key>}, never a bare payload
  // (see backend/internal/health/triage/core/handler.go's ListProfiles) — and
  // "profiles" is null, not [], when the caller has none yet.
  const { data } = await api.get<{ profiles: GoProfile[] | null }>(`${TRIAGE_API_BASE}/profiles`);
  return (data.profiles ?? []).map(mapProfile);
}

export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  if (USE_MOCK) {
    await delay();
    const profile: Profile = { id: `prof_${Date.now()}`, ...input };
    MOCK_PROFILES.push(profile);
    return profile;
  }
  // CreateProfile binds {kind,name,sex,dob,is_pregnant} via ShouldBindJSON — Go's
  // JSON key matching is case-insensitive but does NOT ignore the underscore, so
  // posting the TS input as-is (isPregnant) silently dropped it to false every
  // time (SC-9 maternal caution never applies to a real profile created live).
  const { data } = await api.post<{ profile: GoProfile }>(`${TRIAGE_API_BASE}/profiles`, {
    kind: input.kind,
    name: input.name,
    sex: input.sex,
    dob: input.dob,
    is_pregnant: input.isPregnant ?? false,
  });
  return mapProfile(data.profile);
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
  // StartSession binds StartParams{profile_id, language, channel, consent_scope}
  // — posting `input` as-is (profileId, consent: true) meant profile_id NEVER
  // bound (same camelCase/snake_case gap as createProfile), so every live
  // session lost its profile link. That's not just cosmetic: core/service.go's
  // deidentify() reads sess.ProfileID to get age/sex/pregnancy for the engine +
  // red-flag layer — a null profile_id means SC-9 (paediatric/maternal caution)
  // silently never engages for any real session.
  const { data } = await api.post<{ session: GoSession; disclaimer: string }>(
    `${TRIAGE_API_BASE}/sessions`,
    {
      profile_id: input.profileId,
      language: input.language,
      channel: input.channel,
      consent_scope: { consent: input.consent },
    },
  );
  return {
    id: data.session.id,
    state: mapSessionState(data.session.state),
    disclaimer: data.disclaimer,
  };
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
  // SubmitIntake wraps {success, result: SessionView} — a nested
  // {session, possible_causes, disposition?, next_question?, disclaimer}, not
  // the flat {id,state,question,done,disposition,redFlag} InterviewStep shape.
  const { data } = await api.post<{ result: GoSessionView }>(
    `${TRIAGE_API_BASE}/sessions/${sessionId}/intake`,
    { raw_text: input.rawText, body_map: input.bodyMap },
  );
  return mapInterviewStep(data.result);
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
  // Answer wraps {success, result: SessionView} — same reshape as SubmitIntake.
  // Note: Go's Answer binds `value` as a plain string; mapQuestion() always
  // types live questions as single_select (Go sends no `type`), so
  // interview.tsx never puts a string[] here — matches the Go bind.
  const { data } = await api.post<{ result: GoSessionView }>(
    `${TRIAGE_API_BASE}/sessions/${sessionId}/answer`,
    { code: input.code, value: input.value },
  );
  return mapInterviewStep(data.result);
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
  // GetSession wraps {success, result: SessionView} — same nested shape as the
  // intake/answer responses; see mapTriageResult for the reshape.
  const { data } = await api.get<{ result: GoSessionView }>(`${TRIAGE_API_BASE}/sessions/${sessionId}`);
  return mapTriageResult(data.result);
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
  // Refer wraps {success, result: ReferResult} — {referral, emergency?,
  // escalation?} — NOT {success, referral} as the naming pattern elsewhere in
  // this file might suggest; confirmed against care/handler.go's Refer handler.
  const { data } = await api.post<{ result: GoReferResult }>(
    `${TRIAGE_API_BASE}/sessions/${sessionId}/refer`,
    { level: input.level },
  );
  return mapReferral(data.result);
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
  // PayReferral wraps {success, referral: CareReferral} — the FULL referral
  // record (state machine: created→routed→paid→…), not a bare {state}. The
  // wallet checkout (usePurchasePayment) treats a resolved promise here as
  // proof of a completed charge, so this must never assert success the ledger
  // didn't confirm (IRON RULE) — but it also must not assert FAILURE on a
  // charge that landed. care/service.go's PayReferral charges the wallet, does
  // the guarded routed→paid transition, then IMMEDIATELY best-effort-advances
  // paid→fulfilled in the same call (the booking already exists) — so a
  // successful charge almost always comes back as "fulfilled", never "paid".
  // A retry after that (idempotent re-apply) returns whatever terminal state
  // is already on the row. Anything at/after "paid" means the charge landed;
  // only "created"/"routed" means it didn't.
  const { data } = await api.post<{ referral: GoCareReferral }>(
    `${TRIAGE_API_BASE}/referrals/${input.referralId}/pay`,
    {},
    { headers: { 'Idempotency-Key': input.idempotencyKey } },
  );
  const CHARGED_STATES = new Set(['paid', 'fulfilled', 'follow_up', 'closed']);
  if (!CHARGED_STATES.has(data.referral.state)) {
    throw new Error(`triage: referral did not reach paid state (got "${data.referral.state}")`);
  }
  return { state: 'PAID' };
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
  // NearestEmergency wraps {success, emergency: care.EmergencyInfo} — see
  // mapEmergencyInfo for the facility_name/ambulance_number/first_aid reshape.
  const { data } = await api.get<{ emergency: GoEmergencyInfo }>(`${TRIAGE_API_BASE}/emergency/nearest`, {
    params: { lat, lng },
  });
  return mapEmergencyInfo(data.emergency);
}

// ── Records + feedback (mock no-ops) ─────────────────────────────────────────
// NOTE: unlike every other function above, these two do NOT have a matching
// Go route at all — there is no /sessions/:id/save or /sessions/:id/feedback
// handler anywhere in backend/internal/health/triage (core, care, or
// governance). USE_MOCK=false will 404 here regardless of the response
// envelope; this is a missing-endpoint gap, not something an envelope fix can
// address, and is out of scope for this change — flagged separately.
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
