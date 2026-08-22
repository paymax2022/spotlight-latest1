#!/usr/bin/env node
/**
 * use-env — point the app at a named environment.
 *
 * Expo loads `.env`, and every EXPO_PUBLIC_* value is INLINED INTO THE BUNDLE at
 * build time. Editing `.env` while Metro is running therefore changes nothing:
 * the running bundle keeps the old API base URL, the old Supabase project and
 * the old mock flags, and the app carries on talking to whatever it was built
 * against. That failure is silent and looks exactly like a backend bug, so this
 * script always tells you to restart Metro with a cleared cache.
 *
 * Usage:
 *   node scripts/use-env.mjs staging
 *   node scripts/use-env.mjs development
 *   node scripts/use-env.mjs --which     # what is .env currently pointing at?
 *
 * It copies `.env.<target>` over `.env` rather than symlinking, because Metro
 * follows a symlink to its target's mtime and can miss the swap.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KEYS = ['EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL'];

function parse(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function describe(file, label) {
  const env = parse(file);
  if (!Object.keys(env).length) return `${label}: (absent)`;
  const mocked = Object.entries(env).filter(([k, v]) => k.endsWith('_USE_MOCK') && v !== 'false').length;
  const lines = KEYS.map((k) => `    ${k.replace('EXPO_PUBLIC_', '')} = ${env[k] ?? '(unset)'}`);
  lines.push(`    modules still on MOCK data: ${mocked}`);
  return `${label}:\n${lines.join('\n')}`;
}

const arg = process.argv[2];

if (!arg || arg === '--which') {
  console.log(describe(resolve('.env'), 'current .env'));
  process.exit(0);
}

const target = arg === 'develop' ? 'development' : arg;
const src = resolve(`.env.${target}`);

if (!existsSync(src)) {
  console.error(`✗ .env.${target} does not exist.`);
  console.error(`  Create it from the template and fill in the real values:`);
  console.error(`     cp .env.${target}.example .env.${target}`);
  process.exit(1);
}

const env = parse(src);
const placeholders = Object.entries(env).filter(([, v]) => /CHANGE_ME/.test(v)).map(([k]) => k);
if (placeholders.length) {
  console.error(`✗ .env.${target} still has ${placeholders.length} CHANGE_ME placeholder(s):`);
  for (const k of placeholders) console.error(`    ${k}`);
  console.error(`  Fill them in — a placeholder URL fails at runtime, not at switch time.`);
  process.exit(1);
}

copyFileSync(src, resolve('.env'));
console.log(`✓ switched to "${target}"  (.env.${target} → .env)`);
console.log(describe(resolve('.env'), '  now'));
console.log('');
console.log('  EXPO_PUBLIC_* values are baked into the bundle, so a running Metro');
console.log('  still serves the OLD environment. Restart with a cleared cache:');
console.log('');
console.log('      npx expo start --port 8083 -c');
