#!/usr/bin/env node
//
// scripts/qa/target.mjs — shared "which environment are we testing?" resolution
// for the environment-facing stages of release-qa.yml (AI exploratory QA and the
// performance smoke).
//
// WHY THIS IS A MODULE AND NOT TWO COPIES
// Both stages probe a deployed URL rather than the checked-out tree, so both can
// silently test the WRONG THING in the same two ways, and in both cases the stage
// still goes green:
//
//   1. They can point at a different environment than the operator believes (the
//      staging/production hosts differ only by a suffix, and a guessed hostname
//      fails in a way that reads as "the deploy is broken" — see the note in
//      docs/qa/environments-and-data.md and the -ade6/-5a67/-ec46 suffixes).
//   2. They can point at an environment that is running an OLDER BUILD. This is
//      the expensive one: a PR pipeline that probes staging is testing whatever
//      staging last deployed, not the commit under review. Without saying so, the
//      run report reads as "this commit passed perf + exploratory QA".
//
// So the target is resolved in exactly one place, and it carries the deployed
// commit with it. GET /api/v1/public/build reports the commit the running binary
// was built from (ci.yml stamps backend/BUILD_COMMIT from github.sha), which is
// the only way to tell "tested this build" from "tested some build".
//
// The comparison is a WARNING, never a failure: on a pull_request there is no
// preview deployment, so a mismatch is the normal and expected state. What is not
// acceptable is a mismatch nobody was told about.

import { appendFileSync } from 'node:fs';

const DEFAULTS = {
  // From `railway domain list` for project e7dca861-3667-4d9a-8090-6d2f4d179ec2,
  // environment "staging". Do not "tidy" these into unsuffixed names — the
  // unsuffixed host is not this service and answers with a 502.
  api: 'https://backend-staging-d9bb.up.railway.app',
  web: 'https://frontend-web-staging-ec46.up.railway.app',
  admin: 'https://frontend-admin-staging-ade6.up.railway.app',
};

export class TargetError extends Error {}

function requireHttps(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TargetError(`${label} is not a usable URL: ${url}`);
  }
  // localhost is allowed because a developer running these scripts against a
  // local `go run ./cmd/server` is the other intended use.
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) {
    throw new TargetError(`${label} must be https (or localhost), got: ${url}`);
  }
  return parsed.origin;
}

/**
 * Refuse to aim an automated probe loop at production unless someone said so.
 *
 * Both stages are read-only, so this is not about data safety — it is about the
 * perf smoke adding load, and about an exploratory probe run showing up in
 * production audit logs as unexplained traffic. The check is on the hostname
 * because the environment name is not otherwise visible from a URL.
 */
function guardProduction(origin, label) {
  const host = new URL(origin).hostname;
  const looksLikeProd = /(^|[.-])prod(uction)?([.-]|$)/.test(host) && !host.includes('staging');
  if (!looksLikeProd) return;
  if (process.env.QA_ALLOW_PRODUCTION === 'true') {
    console.log(`  note: ${label} looks like PRODUCTION (${host}) and QA_ALLOW_PRODUCTION=true was set`);
    return;
  }
  throw new TargetError(
    `${label} resolves to what looks like a production host (${host}). ` +
      'Re-run with QA_ALLOW_PRODUCTION=true if that is really intended.',
  );
}

/**
 * Resolve the three base URLs under test.
 * Precedence: explicit argument > QA_*_BASE_URL env > staging defaults.
 */
export function resolveTarget(overrides = {}) {
  const pick = (key, envName, fallback) => {
    const raw = overrides[key] || process.env[envName] || fallback;
    const origin = requireHttps(raw, envName);
    guardProduction(origin, envName);
    return origin;
  };
  return {
    api: pick('api', 'QA_API_BASE_URL', DEFAULTS.api),
    web: pick('web', 'QA_WEB_BASE_URL', DEFAULTS.web),
    admin: pick('admin', 'QA_ADMIN_BASE_URL', DEFAULTS.admin),
  };
}

/**
 * What the backend says it is running.
 * Returns null (not a throw) when the endpoint is unreachable or pre-dates the
 * build stamp: a target with no /public/build is still testable, it just cannot
 * corroborate which commit it is. Callers must treat null as "unknown".
 */
export async function fetchDeployedBuild(apiBase, { timeoutMs = 15000 } = {}) {
  let res;
  try {
    res = await fetch(`${apiBase}/api/v1/public/build`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    return { ok: false, reason: `request failed: ${err.message}` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'response was not JSON' };
  }
  const commit = typeof body.commit === 'string' && body.commit.length >= 7 ? body.commit : null;
  if (!commit) return { ok: false, reason: 'no commit field in the response' };
  return { ok: true, commit, startedAt: body.started_at ?? null, uptimeSeconds: body.uptime_seconds ?? null };
}

/**
 * Compare the deployed commit with the commit this run is testing.
 * 'match' | 'mismatch' | 'unknown' — three states, never collapsed into two.
 */
export function compareBuild(deployed, expectedSha) {
  if (!deployed?.ok || !expectedSha) return 'unknown';
  const a = deployed.commit.toLowerCase();
  const b = String(expectedSha).toLowerCase();
  const len = Math.min(a.length, b.length);
  if (len < 7) return 'unknown';
  return a.slice(0, len) === b.slice(0, len) ? 'match' : 'mismatch';
}

/**
 * Print (and, in Actions, emit) the target banner both stages open with.
 * Deliberately prints URLs and commit shas only — no headers, no tokens.
 */
export function announceTarget(target, deployed, expectedSha) {
  const verdict = compareBuild(deployed, expectedSha);
  console.log('── target under test ─────────────────────────────────');
  console.log(`  api    ${target.api}`);
  console.log(`  web    ${target.web}`);
  console.log(`  admin  ${target.admin}`);
  if (deployed?.ok) {
    console.log(`  deployed commit ${deployed.commit.slice(0, 12)} (started ${deployed.startedAt ?? '?'})`);
  } else {
    console.log(`  deployed commit UNKNOWN (${deployed?.reason ?? 'not probed'})`);
  }
  console.log(`  run commit      ${expectedSha ? String(expectedSha).slice(0, 12) : 'UNKNOWN'}`);
  console.log(`  verdict         ${verdict}`);
  console.log('──────────────────────────────────────────────────────');

  if (verdict === 'mismatch' && process.env.GITHUB_ACTIONS === 'true') {
    console.log(
      '::warning title=QA target is running a different build::' +
        `The environment answered with commit ${deployed.commit.slice(0, 12)} but this run is testing ` +
        `${String(expectedSha).slice(0, 12)}. The environment-based stages below describe the DEPLOYED build, not this one.`,
    );
  }
  return verdict;
}

export function writeStepSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
  } catch {
    // A summary is a nicety; failing the stage over it would be exactly the
    // "two different states look alike" mistake in reverse.
  }
}
