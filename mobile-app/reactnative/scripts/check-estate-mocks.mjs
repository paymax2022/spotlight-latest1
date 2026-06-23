#!/usr/bin/env node
/**
 * check-estate-mocks — production deploy gate (Block 47d).
 *
 * Asserts that every estate module's EXPO_PUBLIC_<X>_USE_MOCK flag is explicitly
 * set to "false" in the given env file (default: .env.production). The dual
 * mock/live data layers default to MOCK, so a *missing* flag silently ships mock
 * data — this guard turns that into a hard build failure.
 *
 * Usage:  node scripts/check-estate-mocks.mjs [path-to-env-file]
 * Exit 0 = all live; exit 1 = one or more flags missing or not "false".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The single source of truth for estate (+ estate-adjacent) mock flags. Keep in
// sync with .env.production.example. Each maps to `export const USE_MOCK =
// (process.env.EXPO_PUBLIC_<X>_USE_MOCK ?? 'true') !== 'false'` in its module.
const ESTATE_FLAGS = [
  'EXPO_PUBLIC_DUES_USE_MOCK',
  'EXPO_PUBLIC_MEETINGS_USE_MOCK',
  'EXPO_PUBLIC_TASKS_USE_MOCK',
  'EXPO_PUBLIC_REPAIRS_USE_MOCK',
  'EXPO_PUBLIC_FACILITIES_USE_MOCK',
  'EXPO_PUBLIC_ANNOUNCEMENTS_USE_MOCK',
  'EXPO_PUBLIC_EMERGENCIES_USE_MOCK',
  'EXPO_PUBLIC_DOCUMENTS_USE_MOCK',
  'EXPO_PUBLIC_VENDORS_USE_MOCK',
  'EXPO_PUBLIC_PROPERTIES_USE_MOCK',
  'EXPO_PUBLIC_AINOTES_USE_MOCK',
  'EXPO_PUBLIC_FINANCE_USE_MOCK',
  'EXPO_PUBLIC_ESTATEADMIN_USE_MOCK',
  'EXPO_PUBLIC_NOTIFICATIONS_USE_MOCK',
  'EXPO_PUBLIC_REPORTS_USE_MOCK',
  'EXPO_PUBLIC_ESTATESETTINGS_USE_MOCK',
  'EXPO_PUBLIC_VISITOR_USE_MOCK',
  'EXPO_PUBLIC_ELECTION_USE_MOCK',
];

const file = resolve(process.argv[2] ?? '.env.production');
let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error(`✗ check-estate-mocks — cannot read env file: ${file}`);
  process.exit(1);
}

// Parse simple KEY=VALUE lines (ignore comments / blanks).
const env = {};
for (const line of text.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const problems = [];
for (const flag of ESTATE_FLAGS) {
  if (!(flag in env)) problems.push(`${flag} is MISSING (defaults to mock)`);
  else if (env[flag] !== 'false') problems.push(`${flag}="${env[flag]}" (must be exactly "false")`);
}

if (!env.EXPO_PUBLIC_API_BASE_URL || /CHANGE_ME/.test(env.EXPO_PUBLIC_API_BASE_URL)) {
  problems.push('EXPO_PUBLIC_API_BASE_URL is unset or still a placeholder');
}

if (problems.length) {
  console.error(`✗ check-estate-mocks — ${problems.length} issue(s) in ${file}:`);
  for (const p of problems) console.error('   - ' + p);
  process.exit(1);
}

console.log(`✓ check-estate-mocks — all ${ESTATE_FLAGS.length} estate flags live (false) and API base URL set in ${file}.`);
