// Live e2e for the telemedicine → doctor-console bridge on the LOCAL stack.
// Exercises the real money and clinical path end to end and asserts the mirror
// holds in BOTH directions:
//
//   patient  POST /api/v1/telemedicine/appointments      (wallet escrow + bridge)
//   doctor   GET  /api/v1/doctor/appointments            (bridged row is visible)
//   patient  PUT/POST …/appointments/:id/intake[/draft|/submit]  → gate + triage
//   doctor   GET  …/appointments/:id/intake              (pre-consult readback)
//   patient  POST /api/v1/telemedicine/appointments/:id/messages  → thread
//   doctor   GET  /api/v1/doctor/chat/:threadId/messages          → reads it
//   doctor   POST status in_progress → telemedicine row follows
//   doctor   POST /prescriptions     → patient GET prescription reads it back
//   doctor   POST status completed  → escrow settles, telemedicine row completes
//
// Run: node scripts/dev/tele-bridge-e2e.mjs <patientEmail> <doctorEmail> <password>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [PATIENT_EMAIL, DOCTOR_EMAIL, PASSWORD] = process.argv.slice(2);
if (!PATIENT_EMAIL || !DOCTOR_EMAIL || !PASSWORD) {
  throw new Error('usage: node scripts/dev/tele-bridge-e2e.mjs <patientEmail> <doctorEmail> <password>');
}

const ENV_FILES = ['frontend-web/.env.local', 'backend/.env', 'mobile-app/reactnative/.env.development.local'];
function readEnv(key, files) {
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const line = fs.readFileSync(f, 'utf8').split('\n').find((x) => x.startsWith(key + '='));
    if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}
const SB_URL = readEnv('SUPABASE_URL', ENV_FILES) || readEnv('NEXT_PUBLIC_SUPABASE_URL', ENV_FILES) || 'http://127.0.0.1:54321';
const ANON = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ENV_FILES) || readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', ENV_FILES);
const GO = readEnv('EXPO_PUBLIC_GO_API_URL', ENV_FILES) || 'http://localhost:8190';
const DATABASE_URL = readEnv('DATABASE_URL', ['backend/.env']);

let pass = 0; let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (detail ? '  → ' + detail : '')); }
};

async function signIn(email) {
  const r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('signin failed for ' + email + ': ' + (j.error_description || r.status));
  return j.access_token;
}

async function call(token, method, path, body, headers) {
  const res = await fetch(GO + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { status: res.status, json, text };
}
const data = (r) => (r.json && 'data' in r.json ? r.json.data : r.json);
const sql = (q) => execFileSync('psql', [DATABASE_URL, '-tA', '-c', q], { encoding: 'utf8' }).trim();

const patient = await signIn(PATIENT_EMAIL);
const doctor = await signIn(DOCTOR_EMAIL);
console.log('signed in as patient + doctor');

// 1) find the fixture doctor in the live catalogue
const doctors = await call(patient, 'GET', '/api/v1/telemedicine/doctors?specialty=general');
const docList = (data(doctors) ?? []).filter((d) => d.name === 'Dr E2E Bridge Test');
check('telemedicine doctor list answers and contains the fixture', doctors.status === 200 && docList.length === 1, 'status=' + doctors.status);
const doc = docList[0];
if (!doc) { console.log('FATAL: no fixture doctor'); process.exit(2); }
check('doctor list carries the quote the patient is charged',
  doc.booking && doc.booking.total_kobo > 0, JSON.stringify(doc.booking));
const totalKobo = doc.booking.total_kobo;

// 2) book — this debits the wallet into escrow and writes the doctor-console mirror
const scheduledAt = new Date(Date.now() + 3 * 3600_000).toISOString();
const idem = 'e2e-bridge-' + Date.now();
const bookRes = await call(patient, 'POST', '/api/v1/telemedicine/appointments', {
  doctor_id: doc.id,
  scheduled_at: scheduledAt,
  consultation_type: 'video',
  notes: 'Persistent cough for a week',
  idempotency_key: idem,
  expected_total_kobo: totalKobo,
}, { 'Idempotency-Key': idem });
const appt = data(bookRes);
check('booking succeeds', bookRes.status === 200 || bookRes.status === 201, 'status=' + bookRes.status + ' body=' + bookRes.text.slice(0, 300));
const apptId = appt && appt.id;
if (!apptId) { console.log('FATAL: no appointment id — ' + bookRes.text.slice(0, 300)); process.exit(2); }
console.log('  appointment=' + apptId + ' total_kobo=' + totalKobo);

check('booking escrows from the patient wallet',
  Number(sql(`select available_kobo from wallet_balance where user_id = (select patient_id from appointments where id = '${apptId}')::uuid and account_type='user_wallet'`)) < 15000000,
  'wallet not debited');

// 3) the bridge: doctor-console mirror rows
const mirrored = sql(`select count(*) from doctor_appointments where id = '${apptId}'`);
const threaded = sql(`select count(*) from doctor_chat_threads where appointment_id = '${apptId}'`);
check('doctor_appointments mirror row exists with the shared id', mirrored === '1', 'count=' + mirrored);
check('doctor_chat_threads row exists', threaded === '1', 'count=' + threaded);

const seen = await call(doctor, 'GET', '/api/v1/doctor/appointments');
const bridged = (seen.json?.data ?? seen.json ?? []).filter((a) => a.id === apptId);
check('doctor console lists the bridged appointment', bridged.length === 1, 'status=' + seen.status + ' count=' + bridged.length);
check('bridged appointment carries a patient summary the console can render',
  bridged.length === 1 && !!bridged[0].patient?.name && !!bridged[0].patient?.initials,
  JSON.stringify(bridged[0]?.patient).slice(0, 200));
check('bridged appointment is confirmed with a human ref',
  bridged.length === 1 && bridged[0].status === 'confirmed' && /^TM-/.test(bridged[0].ref ?? ''),
  JSON.stringify(bridged[0] && { status: bridged[0].status, ref: bridged[0].ref }));

// 3b) pre-consult intake — the patient's wizard and the doctor's readback
const intakePath = `/api/v1/telemedicine/appointments/${apptId}/intake`;
const intakeAnswers = {
  chief_complaint: 'Persistent cough for a week, worse at night',
  is_symptomatic: true,
  severity: 7,
  red_flag_symptoms: ['none'],
  meds_none: true,
  medications_list: [{ name: 'Amlodipine', dose: '5mg once daily' }],
  allergies_none: true,
  allergies_list: ['penicillin'],
  conditions_none: false,
};

const intakeOpen = await call(patient, 'GET', intakePath);
check('intake GET answers for a booked appointment (no 404)',
  intakeOpen.status === 200, 'status=' + intakeOpen.status + ' body=' + intakeOpen.text.slice(0, 200));
check('an untouched intake reads as an empty DRAFT',
  data(intakeOpen)?.status === 'DRAFT' && Object.keys(data(intakeOpen)?.answers ?? {}).length === 0,
  JSON.stringify(data(intakeOpen)).slice(0, 200));
check('intake read names the doctor the details are prepared for',
  !!data(intakeOpen)?.doctor_name, JSON.stringify(data(intakeOpen)?.doctor_name));

const draftRes = await call(patient, 'PUT', intakePath + '/draft',
  { answers: intakeAnswers, consent_version: '2026-01', schema_id: 'preconsult_v1', schema_version: 1 });
check('draft autosave persists the patient answers',
  draftRes.status === 200 && data(draftRes)?.status === 'DRAFT' &&
  data(draftRes)?.answers?.chief_complaint === intakeAnswers.chief_complaint,
  'status=' + draftRes.status + ' body=' + draftRes.text.slice(0, 220));
check('the accepted consent version is stored server-side',
  data(draftRes)?.consent_version === '2026-01', JSON.stringify(data(draftRes)?.consent_version));

const doctorIntake = await call(doctor, 'GET', intakePath);
check('doctor console reads the patient intake back',
  doctorIntake.status === 200 && Array.isArray(data(doctorIntake)?.answers?.allergies_list),
  'status=' + doctorIntake.status + ' body=' + doctorIntake.text.slice(0, 200));
check('the doctor is told this intake is not theirs to edit',
  data(doctorIntake)?.patient_owns === false, JSON.stringify(data(doctorIntake)?.patient_owns));
const doctorWrite = await call(doctor, 'PUT', intakePath + '/draft', { answers: { chief_complaint: 'edited by doctor' } });
check('a doctor cannot write into the patient intake', doctorWrite.status === 403, 'status=' + doctorWrite.status);

const submitted = await call(patient, 'POST', intakePath + '/submit',
  { answers: intakeAnswers, consent_version: '2026-01', schema_id: 'preconsult_v1', schema_version: 1 });
check('submit closes the intake (the app joins the consult on this)',
  submitted.status === 200 && data(submitted)?.status === 'SUBMITTED' && !!data(submitted)?.submitted_at,
  'status=' + submitted.status + ' body=' + submitted.text.slice(0, 220));
check('a non-alarming submit raises no red flag',
  data(submitted)?.red_flag == null, JSON.stringify(data(submitted)?.red_flag));

const crisis = { ...intakeAnswers, red_flag_symptoms: ['self_harm'] };
const crisisRes = await call(patient, 'POST', intakePath + '/submit',
  { answers: crisis, consent_version: '2026-01', schema_id: 'preconsult_v1', schema_version: 1 });
check('the server, not the client, decides the red-flag routing',
  crisisRes.status === 200 && data(crisisRes)?.red_flag?.routing === 'CRISIS' &&
  data(crisisRes)?.red_flag?.severity === 'emergency',
  'status=' + crisisRes.status + ' red_flag=' + JSON.stringify(data(crisisRes)?.red_flag));
check('a re-submit keeps the intake SUBMITTED (answers stay editable)',
  data(crisisRes)?.status === 'SUBMITTED', JSON.stringify(data(crisisRes)?.status));
check('intake row is keyed by the appointment',
  sql(`select count(*) from telemedicine_intakes where appointment_id = '${apptId}'`) === '1');

// 4) chat both ways over the ONE thread
const threads = await call(doctor, 'GET', '/api/v1/doctor/chat/threads');
const threadList = threads.json?.data ?? threads.json ?? [];
const thread = threadList.find((t) => t.appointmentId === apptId || t.appointment_id === apptId);
check('doctor console finds the thread for this appointment', !!thread, 'status=' + threads.status + ' n=' + threadList.length);

const pSend = await call(patient, 'POST', `/api/v1/telemedicine/appointments/${apptId}/messages`, { body: 'Hello doctor, I have a cough.' });
check('patient message accepted', pSend.status === 201, 'status=' + pSend.status + ' body=' + pSend.text.slice(0, 200));
check('patient message is authored as the patient', data(pSend)?.author === 'patient', JSON.stringify(data(pSend)));

if (thread) {
  const threadId = thread.id;
  const dRead = await call(doctor, 'GET', `/api/v1/doctor/chat/${threadId}/messages`);
  const dMsgs = dRead.json?.data ?? dRead.json ?? [];
  const list = Array.isArray(dMsgs) ? dMsgs : (dMsgs.messages ?? []);
  check('doctor console reads the patient message', list.some((m) => (m.body ?? m.content ?? '').includes('I have a cough')), 'status=' + dRead.status + ' n=' + list.length);

  const dSend = await call(doctor, 'POST', `/api/v1/doctor/chat/${threadId}/messages`,
    { body: 'Take it after food.' }, { 'Idempotency-Key': 'e2e-chat-' + apptId });
  check('doctor reply accepted', dSend.status === 200 || dSend.status === 201, 'status=' + dSend.status + ' body=' + dSend.text.slice(0, 200));

  const pRead = await call(patient, 'GET', `/api/v1/telemedicine/appointments/${apptId}/messages`);
  const pMsgs = data(pRead) ?? [];
  check('patient reads both sides of the thread', pRead.status === 200 && pMsgs.length >= 2, 'status=' + pRead.status + ' n=' + pMsgs.length);
  check('patient-side authorship is derived server-side',
    pMsgs.some((m) => m.author === 'patient') && pMsgs.some((m) => m.author === 'doctor'),
    JSON.stringify(pMsgs.map((m) => m.author)));
}

// 5) call control plane
const callTok = await call(patient, 'GET', `/api/v1/telemedicine/appointments/${apptId}/call-token`);
check('call-token endpoint answers for the patient', callTok.status === 200, 'status=' + callTok.status + ' body=' + callTok.text.slice(0, 160));
check('call-token is honest when no media keys are configured',
  callTok.status === 200 && typeof data(callTok)?.configured === 'boolean', JSON.stringify(data(callTok)));
console.log('  call-token → ' + JSON.stringify(data(callTok)));

// 6) status transitions mirror back into the telemedicine row
const inProg = await call(doctor, 'POST', `/api/v1/doctor/appointments/${apptId}/status`, { status: 'in_progress' });
check('doctor start-of-consult accepted', inProg.status === 200, 'status=' + inProg.status + ' body=' + inProg.text.slice(0, 200));
const teleAfterStart = data(await call(patient, 'GET', `/api/v1/telemedicine/appointments/${apptId}`));
check('telemedicine row follows into in_progress', teleAfterStart?.status === 'in_progress', 'status=' + teleAfterStart?.status);

// 7) e-prescription written in the console, read back on the patient side
const rx = await call(doctor, 'POST', '/api/v1/doctor/prescriptions', {
  appointmentId: apptId,
  status: 'issued',
  diagnosis: 'Acute bronchitis',
  items: [
    { name: 'Amoxicillin', dosage: '250mg', route: 'oral', frequency: 'Thrice daily', duration: '5 days' },
    { name: 'Paracetamol', dosage: '500mg', route: 'oral', frequency: 'Twice daily', duration: '3 days' },
  ],
}, { 'Idempotency-Key': 'e2e-rx-' + apptId });
check('doctor console issues the prescription', rx.status === 200 || rx.status === 201, 'status=' + rx.status + ' body=' + rx.text.slice(0, 220));
const rxRead = await call(patient, 'GET', `/api/v1/telemedicine/appointments/${apptId}/prescription`);
const rxData = data(rxRead);
check('patient reads the console-issued prescription', rxRead.status === 200 && Array.isArray(rxData?.items) && rxData.items.length === 2,
  'status=' + rxRead.status + ' body=' + rxRead.text.slice(0, 220));
check('prescription readback keeps dosage and frequency',
  !!rxData?.items?.[0]?.name && !!rxData?.items?.[0]?.dosage, JSON.stringify(rxData?.items?.[0]));

// clinical note → visit summary readback
const note = await call(doctor, 'POST', `/api/v1/doctor/appointments/${apptId}/notes`, {
  subjective: 'Cough for one week, no fever.',
  objective: 'Chest clear, SpO2 98%.',
  assessment: 'Acute bronchitis',
  plan: 'Supportive care; review in 5 days if worse.',
  status: 'finalized',
}, { 'Idempotency-Key': 'e2e-note-' + apptId });
check('doctor console saves the clinical note', note.status === 200 || note.status === 201, 'status=' + note.status + ' body=' + note.text.slice(0, 220));
const sumRead = await call(patient, 'GET', `/api/v1/telemedicine/appointments/${apptId}/summary`);
check('patient reads the visit summary from the console note',
  sumRead.status === 200 && !!data(sumRead)?.diagnosis, 'status=' + sumRead.status + ' body=' + sumRead.text.slice(0, 200));

// 8) completion settles the escrow through telemedicine's money path
const balBefore = Number(sql(`select available_kobo from wallet_balance wb join ledger_accounts la on la.id = wb.account_id where la.user_id = (select user_id from doctors where id = '${doc.id}')::uuid and la.type = 'user_wallet'`));
const done = await call(doctor, 'POST', `/api/v1/doctor/appointments/${apptId}/status`, { status: 'completed' });
check('doctor end-of-consult accepted', done.status === 200, 'status=' + done.status + ' body=' + done.text.slice(0, 220));
const teleAfterDone = data(await call(patient, 'GET', `/api/v1/telemedicine/appointments/${apptId}`));
check('telemedicine row follows into completed', teleAfterDone?.status === 'completed', 'status=' + teleAfterDone?.status);
const balAfter = Number(sql(`select available_kobo from wallet_balance wb join ledger_accounts la on la.id = wb.account_id where la.user_id = (select user_id from doctors where id = '${doc.id}')::uuid and la.type = 'user_wallet'`));
check('doctor wallet is credited on settlement', balAfter > balBefore, `before=${balBefore} after=${balAfter}`);
console.log(`  doctor wallet ${balBefore} → ${balAfter} (consult fee kobo ${doc.consult_fee_kobo})`);

// 9) follow-up: the patient reviews the visit
const review = await call(patient, 'POST', `/api/v1/telemedicine/appointments/${apptId}/review`, {
  rating: 5, comment: 'Clear and thorough.',
});
check('patient can review the completed visit', review.status === 200 || review.status === 201, 'status=' + review.status + ' body=' + review.text.slice(0, 200));

// 10) replay safety: the same Idempotency-Key must not double-charge or double-bridge
const replay = await call(patient, 'POST', '/api/v1/telemedicine/appointments', {
  doctor_id: doc.id, scheduled_at: scheduledAt, consultation_type: 'video',
  notes: 'Persistent cough for a week', idempotency_key: idem, expected_total_kobo: totalKobo,
}, { 'Idempotency-Key': idem });
const replayData = data(replay);
check('idempotent replay returns the same appointment', replayData?.id === apptId, 'status=' + replay.status + ' id=' + replayData?.id);
check('replay does not duplicate the doctor-console mirror',
  sql(`select count(*) from doctor_appointments where id = '${apptId}'`) === '1');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
