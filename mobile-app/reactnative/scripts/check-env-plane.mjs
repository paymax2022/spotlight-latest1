#!/usr/bin/env node
/**
 * check-env-plane — refuse to build when a `.env.<profile>` file describes a
 * different plane than the eas.json profile of the same name.
 *
 * Why this exists. Expo selects its env file from NODE_ENV, and build-aab.sh /
 * build-apk.sh run local Gradle, so `eas build`'s profile env never applies to
 * them: the ONLY thing that decides which backend a store artifact talks to is
 * `.env.production`. That file is gitignored, so nothing in the repo could ever
 * notice it had been copied from staging and left there. Found 2026-11-15:
 * `.env.production` carried the staging API host and the staging Supabase
 * project, and `EXPO_PUBLIC_APP_ENV=staging` — which is in serverProfile.ts's
 * SWITCH_ENVIRONMENTS, so the artifact stamped `app-release-production` would
 * have shipped with the on-device server switch ENABLED and would have read the
 * STAGING module registry. Admin publication on production (the module-readiness
 * portal) would then govern nothing the store user sees.
 *
 * eas.json is tracked, and its `production` profile already states the whole
 * production plane. It is therefore the reference: one file to change when a
 * service is renamed, and this guard makes the untracked copy agree with it or
 * the build stops before Gradle runs.
 *
 * Usage:  node scripts/check-env-plane.mjs [.env.production] [--eas <eas.json>]
 * Exit 0 = every marker the profile declares matches the env file exactly.
 *
 * Compared: EXPO_PUBLIC_API_BASE_URL, EXPO_PUBLIC_SUPABASE_URL,
 * EXPO_PUBLIC_APP_ENV. Deliberately NOT compared: EXPO_PUBLIC_SUPABASE_ANON_KEY
 * and every other credential — the Supabase URL already names the project, and a
 * guard that touches secrets is a guard that eventually prints one.
 *
 * The pair: export-eas-profile-env.mjs asserts eas.json's own profile is a
 * deployable plane (for the `eas update` OTA path, which reads no .env file). This
 * asserts the opposite direction — that the .env file these Gradle-path scripts
 * bake matches the profile that script validates. eas.json is the reference for
 * both, so a plane rename is a one-file change.
 */
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// The three values that together define "which plane this build is for". A URL
// comparison is on host, so a scheme- or trailing-slash difference between the
// two files is not treated as a plane change; a value difference is.
const MARKERS = ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_APP_ENV'];
// serverProfile.ts: the on-device Remote/Local switch is enabled for any of these.
const SWITCH_ENVIRONMENTS = new Set(['development', 'dev', 'staging', 'test', 'local']);

const argv = process.argv.slice(2);
let envFile = '.env.production';
let easFile = 'eas.json';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--eas') { easFile = argv[++i]; continue; }
  envFile = argv[i];
}
envFile = resolve(envFile);
easFile = resolve(easFile);
const profile = basename(envFile).replace(/^\.env\./, '');

function fail(msg) {
  console.error(`✗ check-env-plane — ${msg}`);
  process.exit(1);
}

let envText;
try {
  envText = readFileSync(envFile, 'utf8');
} catch {
  fail(`cannot read env file: ${envFile}`);
}
let eas;
try {
  eas = JSON.parse(readFileSync(easFile, 'utf8'));
} catch (e) {
  fail(`cannot read/parse ${easFile} — it is the reference for this check (${e.message})`);
}

const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !/^\s*#/.test(line)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const profileDef = (eas.build || {})[profile];
if (!profileDef) {
  console.log(`✓ check-env-plane — eas.json has no "${profile}" profile to disagree with; nothing compared.`);
  process.exit(0);
}
const reference = (profileDef.env || {});
const enforced = MARKERS.filter((k) => k in reference);
if (enforced.length === 0) {
  console.log(`✓ check-env-plane — eas.json's "${profile}" profile declares none of the plane markers (extends=${profileDef.extends || 'nothing'}); nothing compared.`);
  process.exit(0);
}

const host = (u) => {
  try { return new URL(u).host; } catch { return u; }
};
// A URL marker is compared on host, so a scheme/port-less or trailing-slash
// difference between the two files is not reported as a plane change. Everything
// else (APP_ENV) is compared exactly, after trimming — 'prd' must not pass as
// 'production'.
const isUrlMarker = (key) => /URL$/.test(key);
const norm = (key, value) => (isUrlMarker(key) ? host(String(value).trim()) : String(value).trim());
const problems = [];
for (const key of enforced) {
  const want = String(reference[key]).trim();
  const got = key in env ? String(env[key]).trim() : undefined;
  if (got === undefined) { problems.push(`${key} is MISSING from ${basename(envFile)} but eas.json's "${profile}" profile sets it`); continue; }
  if (norm(key, got) === norm(key, want)) continue;
  problems.push(`${key} → ${isUrlMarker(key) ? `${norm(key, got)} (want ${norm(key, want)})` : `"${got}" (want "${want}")`}`);
}

if (problems.length) {
  console.error(`✗ check-env-plane — ${basename(envFile)} targets a different plane than eas.json's "${profile}" profile:`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error('');
  console.error(`   A release build bakes exactly this file (Expo picks .env.<NODE_ENV>, and these scripts`);
  console.error(`   run local Gradle, so eas.json's own env never applies). The artifact is written as`);
  console.error(`   app-release-${profile}.* regardless, so the mismatch is invisible after the build.`);
  if ((env.EXPO_PUBLIC_APP_ENV || '') !== '' && SWITCH_ENVIRONMENTS.has(env.EXPO_PUBLIC_APP_ENV.trim())) {
    console.error(`   EXPO_PUBLIC_APP_ENV="${env.EXPO_PUBLIC_APP_ENV}" also enables the on-device server switch`);
    console.error(`   (serverProfile.ts SWITCH_ENVIRONMENTS) in a build that Play will serve to live users.`);
  }
  console.error('');
  console.error(`   Fix: set the ${profile}-plane values in ${basename(envFile)} to match eas.json's "${profile}"`);
  console.error(`   profile, or — if you meant to build the other plane — select that env explicitly`);
  console.error(`   (e.g. NODE_ENV=staging ./build-aab.sh).`);
  process.exit(1);
}

console.log(`✓ check-env-plane — ${basename(envFile)} matches eas.json's "${profile}" profile on ${enforced.length}/${enforced.length} markers (${env.EXPO_PUBLIC_APP_ENV}).`);
