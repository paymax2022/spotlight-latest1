#!/usr/bin/env node
// Build/CI assertion: refuse to ship admin modules on MOCK data unless explicitly
// allowlisted. Models the services' real resolution (MOCK unless the flag is
// 'false'), loads env the way Next does, and — with --strict (or MOCK_CHECK_STRICT=1)
// — exits non-zero if any non-allowlisted module would ship mock.
//
// Usage:
//   node scripts/check-mock-flags.mjs                       # report only (exit 0)
//   NODE_ENV=production node scripts/check-mock-flags.mjs --strict   # CI gate (exit 1 on offenders)
//
// Wire the strict form into the production CI pipeline (before `next build`) so a
// forgotten flag can never silently ship fabricated data to an operator.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const STRICT = process.argv.includes('--strict') || process.env.MOCK_CHECK_STRICT === '1';
const IS_PROD = process.env.NODE_ENV === 'production';

// Modules that legitimately have NO backend yet and may run on mock in production.
// BURN THIS DOWN: when a backend lands, set the flag to 'false' (live) and delete
// the entry here. { FLAG: reason }
const MOCK_ALLOWLIST = {
  NEXT_PUBLIC_FX_ADMIN_USE_MOCK: 'FX admin endpoints not built yet (mock-only).',
  NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK: 'Restaurant admin ops routes not built yet.',
  NEXT_PUBLIC_GROUPS_ADMIN_USE_MOCK: 'Groups (savings pools) has NO admin route group in Go — only 5 member endpoints exist under /api/finance/groups. The pages render a SampleDataBanner while this is allowlisted.',
};

const FLAG_RE = /NEXT_PUBLIC_[A-Z0-9_]+_USE_(?:MOCK|FIXTURES)/g;

function walk(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function collectFlags() {
  const flags = new Set();
  for (const file of walk(SRC)) {
    const m = readFileSync(file, 'utf8').match(FLAG_RE);
    if (m) for (const f of m) flags.add(f);
  }
  return [...flags].sort();
}

// Load .env files exactly as Next does, so we assert against the real values.
async function loadEnv() {
  try {
    const { loadEnvConfig } = await import('@next/env');
    loadEnvConfig(ROOT, !IS_PROD);
  } catch {
    console.warn('  [check-mock-flags] @next/env not available — reading process.env only.');
  }
}

// Service reality: MOCK unless the flag is explicitly 'false'. Conservative — once a
// service adopts resolveUseMock (unset ⇒ live in prod) this may over-report mock,
// which fails closed; it never falsely reports LIVE.
const isMock = (flag) => ((process.env[flag] ?? '').trim().toLowerCase() !== 'false');

async function main() {
  await loadEnv();
  const flags = collectFlags();
  const rows = flags.map((flag) => ({
    flag,
    mock: isMock(flag),
    allow: Object.prototype.hasOwnProperty.call(MOCK_ALLOWLIST, flag),
  }));
  const offenders = rows.filter((r) => r.mock && !r.allow);
  const liveN = rows.filter((r) => !r.mock).length;
  const allowN = rows.filter((r) => r.mock && r.allow).length;
  const pad = Math.max(8, ...flags.map((f) => f.length));

  console.log(`\n  Admin mock-flag audit  (env: ${IS_PROD ? 'production' : process.env.NODE_ENV || 'development'}${STRICT ? ', STRICT' : ''})`);
  console.log(`  ${'FLAG'.padEnd(pad)}  MODE   NOTE`);
  for (const r of rows) {
    const note = !r.mock ? '' : r.allow ? `allowlisted: ${MOCK_ALLOWLIST[r.flag]}` : 'SHIPS MOCK — set =false or allowlist';
    console.log(`  ${r.flag.padEnd(pad)}  ${(r.mock ? 'MOCK' : 'LIVE').padEnd(5)}  ${note}`);
  }
  console.log(`\n  ${flags.length} flags · ${liveN} live · ${allowN} allowlisted-mock · ${offenders.length} unlisted-mock`);

  if (!offenders.length) {
    console.log('  ✔ No unlisted modules ship mock.\n');
    return;
  }
  const list = offenders.map((o) => o.flag).join(', ');
  if (STRICT) {
    console.error(`\n  ✖ ${offenders.length} module(s) would ship MOCK in production without being allowlisted:\n    ${list}\n  Fix: set each to 'false' (live) in the production env, or add to MOCK_ALLOWLIST with a reason.\n`);
    process.exit(1);
  }
  console.warn(`\n  ⚠ ${offenders.length} module(s) resolve to MOCK and are not allowlisted (${list}).\n    Warning only. Run with --strict (or MOCK_CHECK_STRICT=1) in CI to make it a hard failure.\n`);
}

main().catch((err) => {
  console.warn(`  [check-mock-flags] skipped: ${err?.message || err}`);
  process.exit(STRICT ? 1 : 0);
});
