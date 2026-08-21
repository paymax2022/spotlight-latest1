#!/usr/bin/env node
/**
 * check-env-mocks — deploy gate for every dual mock/live data layer.
 *
 * Supersedes check-estate-mocks.mjs, which asserted a HARDCODED list of 18
 * estate flags. That list drifted: 11 `*_USE_MOCK` flags reached the code
 * without ever reaching .env.production.example, and because every flag
 * defaults to MOCK when missing, those modules shipped fake data with nothing
 * failing. A hardcoded list cannot catch a flag it has never heard of, so this
 * guard DERIVES the flag set from the source tree instead — a new module's flag
 * is enforced the moment it is referenced in code.
 *
 * Usage:  node scripts/check-env-mocks.mjs [path-to-env-file]
 * Exit 0 = every derived flag is explicitly "false" (or allow-listed).
 *
 * A flag that is deliberately left on mock must be allow-listed IN THE ENV FILE
 * (not in this script), so the exception is visible where it takes effect:
 *
 *   # check-env-mocks: allow EXPO_PUBLIC_SCHEDULED_USE_MOCK  reason goes here
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const FLAG_RE = /EXPO_PUBLIC_[A-Z0-9_]*_USE_MOCK/g;
const SCAN_DIRS = ['src', 'app'];
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Every *_USE_MOCK flag referenced anywhere in the app source. */
function deriveFlags() {
  const found = new Set();
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!SCAN_EXT.has(extname(p))) continue;
      const m = readFileSync(p, 'utf8').match(FLAG_RE);
      if (m) for (const f of m) found.add(f);
    }
  };
  for (const d of SCAN_DIRS) walk(d);
  return [...found].sort();
}

const file = resolve(process.argv[2] ?? '.env.production');
let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error(`✗ check-env-mocks — cannot read env file: ${file}`);
  process.exit(1);
}

const env = {};
const allowed = new Set();
for (const line of text.split('\n')) {
  const allow = line.match(/^\s*#\s*check-env-mocks:\s*allow\s+([A-Z0-9_]+)/);
  if (allow) { allowed.add(allow[1]); continue; }
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const flags = deriveFlags();
if (flags.length === 0) {
  console.error('✗ check-env-mocks — derived 0 flags; the source scan is broken, refusing to pass.');
  process.exit(1);
}

const problems = [];
for (const flag of flags) {
  if (allowed.has(flag)) continue;
  if (!(flag in env)) problems.push(`${flag} is MISSING (a missing flag defaults to MOCK)`);
  else if (env[flag] !== 'false') problems.push(`${flag}="${env[flag]}" (must be exactly "false")`);
}

for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']) {
  if (!env[key] || /CHANGE_ME/.test(env[key])) problems.push(`${key} is unset or still a CHANGE_ME placeholder`);
}

if (problems.length) {
  console.error(`✗ check-env-mocks — ${problems.length} issue(s) in ${file} (${flags.length} flags derived from source):`);
  for (const p of problems) console.error('   - ' + p);
  process.exit(1);
}

const skipped = flags.filter((f) => allowed.has(f));
console.log(
  `✓ check-env-mocks — ${flags.length - skipped.length}/${flags.length} derived flags live (false) in ${file}` +
  (skipped.length ? `; ${skipped.length} allow-listed on mock: ${skipped.join(', ')}` : '') + '.'
);
