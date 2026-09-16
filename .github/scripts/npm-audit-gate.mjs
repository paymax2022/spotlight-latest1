#!/usr/bin/env node
//
// npm audit gate with an explicit baseline.
//
// WHY
// `npm audit --omit=dev --audit-level=high` fails on all three JS workspaces and
// cannot be made to pass by patching: every residual advisory is only fixed by a
// framework major (expo@57 + react-native@0.72, next@16 + sharp@0.35). A gate
// that is permanently red teaches everyone to ignore it, which is worse than no
// gate — a genuinely NEW advisory would land unnoticed among the known ones.
//
// So the gate becomes differential. Known advisories are listed, with a reason,
// in .github/npm-audit-baseline/<workspace>.json. The gate fails only on an
// advisory that is NOT in the baseline. Same shape as the gitleaks allowlist.
//
// It also fails when a baselined advisory has DISAPPEARED, so the file cannot
// quietly rot into a list of things that stopped being true — if you fix one,
// you are told to drop it from the baseline.
//
// Usage:  node .github/scripts/npm-audit-gate.mjs <workspace-dir> <baseline.json>

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [dir, baselinePath] = process.argv.slice(2);
if (!dir || !baselinePath) {
  console.error('usage: npm-audit-gate.mjs <workspace-dir> <baseline.json>');
  process.exit(2);
}

// A FAILED audit and a CLEAN audit must never look alike here.
//
// npm audit exits non-zero both when it finds advisories (normal, the report is
// on stdout) and when it cannot reach the registry. In the second case npm still
// prints JSON on stdout — `{"error": {...}}`, with no `vulnerabilities` key. The
// original code did `report.vulnerabilities ?? {}`, so an unreachable registry
// became "zero advisories found", every baselined entry looked stale, and the
// gate failed telling you to DELETE six legitimate accepted-risk entries. That
// happened on main @ 05092dae: dependencies and baseline were byte-identical to
// the previous passing commit, and a re-run with no changes went green.
//
// So: a clean audit reports `vulnerabilities: {}` — the key PRESENT and empty.
// A failed one omits it. Presence of the key is the discriminator, which is why
// `?? {}` is wrong and `'vulnerabilities' in report` is right.
const sleepSync = ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

function runAudit() {
  try {
    return { raw: execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    }), stderr: '' };
  } catch (err) {
    return { raw: err.stdout || '', stderr: err.stderr || err.message || '' };
  }
}

// Registry blips are transient and common; retry before failing the build. Three
// attempts, not one, because a single network hiccup should not turn main red.
let report = null, lastProblem = '';
for (let attempt = 1; attempt <= 3; attempt++) {
  const { raw, stderr } = runAudit();
  if (!raw) { lastProblem = `npm audit produced no output. ${stderr}`.trim(); }
  else {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { lastProblem = `npm audit emitted unparseable JSON: ${e.message}`; parsed = null; }
    if (parsed) {
      if (parsed.error) {
        const e = parsed.error;
        lastProblem = `npm audit reported an error: ${e.summary || e.code || JSON.stringify(e).slice(0, 200)}`;
      } else if (!('vulnerabilities' in parsed)) {
        lastProblem = 'npm audit output has no "vulnerabilities" key — the audit did not complete.';
      } else {
        report = parsed;
        break;
      }
    }
  }
  if (attempt < 3) {
    console.error(`npm audit attempt ${attempt}/3 failed in ${dir}: ${lastProblem} — retrying`);
    sleepSync(attempt * 3000);
  }
}

if (!report) {
  // Fail CLOSED, and say plainly that nothing was checked. Never fall through to
  // the staleness comparison — with no advisories parsed, every baselined entry
  // looks resolved and the gate would advise gutting the baseline.
  console.error(`::error::npm audit did NOT complete in ${dir} after 3 attempts — no advisories were checked.`);
  console.error(`  ${lastProblem}`);
  console.error('  This is an audit/registry failure, NOT a clean result. The baseline is unaffected:');
  console.error(`  do NOT edit ${baselinePath} on the strength of this run. Re-run the job.`);
  process.exit(2);
}

const vulns = report.vulnerabilities;

// Collect high/critical advisories as stable {package, ghsa} identities. GHSA ids
// are stable across version bumps; package names alone would be too coarse (a new
// axios advisory would hide behind an existing axios entry).
const found = new Map();
for (const [pkg, v] of Object.entries(vulns)) {
  if (v.severity !== 'high' && v.severity !== 'critical') continue;
  for (const via of v.via ?? []) {
    if (typeof via !== 'object' || !via.url) continue;
    const ghsa = (via.url.match(/GHSA-[a-z0-9-]+/i) ?? [via.url])[0];
    found.set(`${pkg}|${ghsa}`, { pkg, ghsa, severity: via.severity ?? v.severity, title: via.title ?? '' });
  }
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
// Keep the baseline ENTRIES, not just their keys, so reporting reads fields
// directly instead of taking a composite key apart again.
const accepted = new Map((baseline.accepted ?? []).map(a => [`${a.package}|${a.ghsa}`, a]));

const unexpected = [...found.entries()].filter(([k]) => !accepted.has(k)).map(([, v]) => v);
const stale = [...accepted.entries()].filter(([k]) => !found.has(k)).map(([, a]) => a);

let bad = false;

if (unexpected.length) {
  bad = true;
  console.error(`::error::${unexpected.length} NEW high/critical advisory(ies) in ${dir} production dependencies:`);
  for (const a of unexpected) {
    console.error(`  [${a.severity}] ${a.pkg} — ${a.ghsa} — ${a.title}`);
  }
  console.error(`::error::Fix them, or — if genuinely unfixable — add them to ${baselinePath} WITH a reason.`);
}

if (stale.length) {
  bad = true;
  console.error(`::error::${stale.length} baselined advisory(ies) in ${baselinePath} no longer appear — remove them so the baseline stays honest:`);
  for (const a of stale) console.error(`  ${a.package} — ${a.ghsa}`);
}

if (!bad) {
  console.log(`OK ${dir}: ${found.size} known high/critical advisory(ies), all baselined, none new.`);
}
process.exit(bad ? 1 : 0);
