#!/usr/bin/env node
// Prints the EXPO_PUBLIC_* env of an eas.json build profile as KEY=value lines
// (the $GITHUB_ENV format), and refuses to print anything if the profile cannot
// produce a working deployed bundle.
//
// `eas update` bundles JS wherever it runs and does NOT read a build profile's
// `env`, so the OTA workflow feeds it through here. The asserts are the gate: an
// OTA without EXPO_PUBLIC_APP_ENV is treated as a development bundle by
// src/config/mockPolicy.ts and ships mock data to real users.
//
// Usage: node scripts/export-eas-profile-env.mjs <profile> >> "$GITHUB_ENV"
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REQUIRED = ['EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];
const DEPLOYED = new Set(['staging', 'production', 'prod']);

function fail(message) {
  console.error(`✗ export-eas-profile-env — ${message}`);
  process.exit(1);
}

const profile = process.argv[2];
if (!profile) fail('usage: export-eas-profile-env.mjs <profile>');

const easJson = JSON.parse(readFileSync(fileURLToPath(new URL('../eas.json', import.meta.url)), 'utf8'));
const env = easJson.build?.[profile]?.env;
if (!env) fail(`eas.json has no build profile "${profile}" with an env block`);

const publicEnv = Object.entries(env).filter(([key]) => key.startsWith('EXPO_PUBLIC_'));
const values = Object.fromEntries(publicEnv);

for (const key of REQUIRED) {
  if (!String(values[key] ?? '').trim()) fail(`profile "${profile}" does not set ${key}`);
}
if (!DEPLOYED.has(String(values.EXPO_PUBLIC_APP_ENV).trim().toLowerCase())) {
  fail(`profile "${profile}" has EXPO_PUBLIC_APP_ENV=${values.EXPO_PUBLIC_APP_ENV}; an OTA must target a deployed environment`);
}
for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL']) {
  if (!/^https:\/\//.test(values[key]) || /localhost|127\.0\.0\.1/.test(values[key])) {
    fail(`profile "${profile}" has a non-https or loopback ${key}`);
  }
}

for (const [key, value] of publicEnv) {
  if (/[\r\n]/.test(String(value))) fail(`${key} contains a newline`);
  console.log(`${key}=${value}`);
}
