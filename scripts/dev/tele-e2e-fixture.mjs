// One-off LOCAL dev fixtures for the telemedicine doctor-console-bridge e2e pass.
// Creates a throwaway patient (tier 1 + wallet credit) and a throwaway doctor
// (approved credential + `doctors` + `doctor_profiles` rows), then prints their
// emails so the e2e driver can log in. Every row it writes is keyed on the auth
// users it creates here — nothing pre-existing is touched.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TS = Date.now();
const PATIENT = `tele-e2e-patient-${TS}@spotlight.internal`;
const DOCTOR = `tele-e2e-doctor-${TS}@spotlight.internal`;
const PASSWORD = `E2eTele-${TS}!x`;

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
const SERVICE_KEY = readEnv('SUPABASE_SERVICE_ROLE_KEY', ENV_FILES);
const DATABASE_URL = readEnv('DATABASE_URL', ['backend/.env']);
if (!SERVICE_KEY || !DATABASE_URL) throw new Error('missing SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL');
if (!/127\.0\.0\.1|localhost/.test(SB_URL)) throw new Error('refusing non-local Supabase: ' + SB_URL);

async function createUser(email) {
  const res = await fetch(SB_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  }).then((r) => r.json());
  const id = res?.id ?? res?.user?.id;
  if (!id) throw new Error('signup failed for ' + email + ': ' + JSON.stringify(res).slice(0, 200));
  return id;
}

const patientId = await createUser(PATIENT);
const doctorId = await createUser(DOCTOR);

// ₦150,000 of spendable balance, posted as a BALANCED pair (user_wallet CREDIT /
// provider_clearing DEBIT) exactly like the real top-up rail, so ledger
// conservation still holds after the fixture runs.
const creditLegs = (userId, key) => [
  `insert into ledger_accounts (id, user_id, type, currency, created_at)
     values (gen_random_uuid(), '${userId}'::uuid, 'user_wallet', 'NGN', now())
     on conflict (user_id, type, currency) do nothing;`,
  `insert into ledger_entries (account_id, type, amount_kobo, reference, idempotency_key, description)
     select a.id, 'CREDIT', 15000000, 'dev:tele-e2e-seed', '${key}', 'Local telemedicine e2e fixture credit'
       from ledger_accounts a
      where a.user_id = '${userId}'::uuid and a.type = 'user_wallet'
        and not exists (select 1 from ledger_entries e where e.idempotency_key = '${key}');`,
  `insert into ledger_entries (account_id, type, amount_kobo, reference, idempotency_key, description)
     select a.id, 'DEBIT', 15000000, 'dev:tele-e2e-seed', '${key}:clearing', 'Local telemedicine e2e fixture funding leg'
       from ledger_accounts a
      where a.type = 'provider_clearing' and a.user_id is null
        and not exists (select 1 from ledger_entries e where e.idempotency_key = '${key}:clearing');`,
].join('\n');

const sql = [
  // Tier 1 so the checkout daily cap applies instead of the Tier-0 gate, which
  // this dev stack has switched off (FEATURE_CHECKOUT_TOPUP_TIER0).
  `insert into user_profiles (id, full_name, kyc_tier)
     values ('${patientId}', 'E2E Patient', 1)
     on conflict (id) do update set kyc_tier = 1, full_name = 'E2E Patient';`,
  creditLegs(patientId, 'dev:tele-e2e-seed:' + patientId),
  // The doctor the patient books: `doctors` is the telemedicine catalogue row,
  // `doctor_profiles` is what the doctor console resolves a session against, and
  // an approved `doctor_verifications` row is the MDCN gate BookAppointment checks.
  `insert into doctors (user_id, name, specialty, consult_fee_kobo, is_available, bio, experience_years)
     values ('${doctorId}', 'Dr E2E Bridge Test', 'general', 350000, true,
             'Consultation created by the local telemedicine e2e fixture.', 6);`,
  `insert into doctor_profiles (user_id, name, email, specialty_id, fee_kobo, verification, is_published)
     values ('${doctorId}', 'Dr E2E Bridge Test', '${DOCTOR}', 'general', 350000, 'approved', true);`,
  `insert into doctor_verifications (user_id, status, mdcn_number)
     values ('${doctorId}', 'approved', 'MDCN-E2E-${TS}');`,
  creditLegs(doctorId, 'dev:tele-e2e-seed:' + doctorId),
].join('\n');

execFileSync('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'inherit' });

const balance = (userId) => execFileSync('psql', [
  DATABASE_URL, '-tA', '-c',
  `select available_kobo from wallet_balance where user_id = '${userId}'::uuid and account_type = 'user_wallet';`,
], { encoding: 'utf8' }).trim();

console.log(JSON.stringify({
  patientEmail: PATIENT,
  doctorEmail: DOCTOR,
  password: PASSWORD,
  patientId,
  doctorUserId: doctorId,
  patientWalletKobo: balance(patientId),
  doctorWalletKobo: balance(doctorId),
}, null, 2));
