#!/usr/bin/env node
//
// scripts/qa/perf-smoke.mjs — the "performance smoke test" stage of release-qa.yml.
//
// WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
// The repo already owns real load tests: tools/loadtest/{marketplace,transport_scheduled}
// run under k6 with a 200-VU ramp and PRD-derived thresholds (p95 < 250ms,
// <1% errors), invoked via `make marketplace-loadtest`. docs/qa/TEST_PLAN.md §7
// schedules those "on demand / pre-go-live" — and they need a real JWT, so they
// cannot run from a PR workflow that has no credentials, and pointing a 200-VU
// ramp at the SHARED staging environment from every PR would be a self-inflicted
// outage for whoever else is testing there.
//
// So this is the smoke, not the load test: a bounded number of unauthenticated
// READ requests against the deployed environment, asserting a latency budget and
// a zero-error budget. It answers "is this build obviously slow or broken end to
// end?" in ~30 seconds. It is NOT a substitute for the k6 runs before go-live,
// and the step summary says so rather than implying a load test happened.
//
// WHY THESE ENDPOINTS
// Each one exercises a different layer, so a regression is attributable instead
// of just "the app got slow":
//   /api/v1/public/health      Go process alive, no DB     — the floor
//   /api/v1/public/build       Go + ldflags stamp          — proves which commit
//   /api/v1/modules/visibility Go + Postgres (publication rows) — the DB path
//   web /                      Next.js SSR                 — the web render path
//   web /api/v1/public/health  Next proxy -> Go            — the proxy hop
//   admin /admin/login         Next.js SSR (admin)         — the console shell
//   admin /api/admin/signup    route handler + Supabase    — the service-role path
//
// Everything here is a GET that requires no credential and mutates nothing,
// which is what makes it safe to run against a shared environment at all.
// (TEST_PLAN.md §2: synthetic data only, no live financial credentials.)

import { resolveTarget, fetchDeployedBuild, announceTarget, writeStepSummary, TargetError } from './target.mjs';

const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${name} must be a positive number, got: ${raw}`);
    process.exit(2);
  }
  return n;
};

// Bounded on purpose: REQUESTS * ENDPOINTS total requests, at CONCURRENCY in
// flight. 8 * 7 = 56 requests is enough for a stable p95 on a healthy service
// and small enough to be invisible in the target's logs.
const REQUESTS = num('PERF_REQUESTS_PER_ENDPOINT', 8);
const CONCURRENCY = num('PERF_CONCURRENCY', 4);
const TIMEOUT_MS = num('PERF_TIMEOUT_MS', 20000);
// Budgets are set from a MEASURED baseline, not from taste: against staging on
// 2026-09-25 the seven endpoints below ran p50 263-488ms and p95 358-809ms, the
// slowest being /api/admin/signup (a Supabase round trip). The defaults are roughly
// 2x that. A budget tight enough to trip on ordinary network jitter produces a gate
// people learn to re-run, which is the same failure mode npm-audit-gate.mjs exists
// to avoid: a red check nobody believes catches nothing. Tighten these only with a
// fresh measurement in hand.
const P95_BUDGET_MS = num('PERF_P95_BUDGET_MS', 2000);
const P50_BUDGET_MS = num('PERF_P50_BUDGET_MS', 900);
// Zero, not "1%": at 8 samples per endpoint a single 5xx IS the finding, and a
// percentage budget would either allow nothing while claiming to allow something
// or allow a whole failed request out of eight.
const MAX_ERRORS = num('PERF_MAX_ERRORS', 0);

const ENDPOINTS = [
  { label: 'api  /public/health', base: 'api', path: '/api/v1/public/health', expect: 200, layer: 'Go, no DB' },
  { label: 'api  /public/build', base: 'api', path: '/api/v1/public/build', expect: 200, layer: 'Go + build stamp' },
  { label: 'api  /modules/visibility', base: 'api', path: '/api/v1/modules/visibility', expect: 200, layer: 'Go + Postgres' },
  { label: 'web  /', base: 'web', path: '/', expect: 200, layer: 'Next SSR' },
  { label: 'web  /api/v1/public/health', base: 'web', path: '/api/v1/public/health', expect: 200, layer: 'Next proxy -> Go' },
  { label: 'adm  /admin/login', base: 'admin', path: '/admin/login', expect: 200, layer: 'Next SSR (admin)' },
  { label: 'adm  /api/admin/signup', base: 'admin', path: '/api/admin/signup', expect: 200, layer: 'route handler + Supabase' },
];

const percentile = (sorted, p) => {
  if (!sorted.length) return NaN;
  // Nearest-rank: with 8 samples a p95 is really "the slowest one", which is the
  // honest reading at this size and the reason the budget is not set tight.
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

async function probeOnce(url) {
  const started = process.hrtime.bigint();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual', // a redirect is a finding, not something to silently follow
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: '*/*', 'user-agent': 'spotlight-release-qa/perf-smoke' },
    });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // Drain the body: an unread response keeps the socket out of the pool and
    // inflates every subsequent sample, which would look like a slow service.
    await res.arrayBuffer().catch(() => {});
    return { ms, status: res.status, error: null };
  } catch (err) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    return { ms, status: 0, error: err.name === 'TimeoutError' ? `timeout >${TIMEOUT_MS}ms` : err.message };
  }
}

async function probeEndpoint(ep, target) {
  const url = `${target[ep.base]}${ep.path}`;
  // One unmeasured warm-up: the first hit pays DNS + TLS + (for Next) a cold
  // route compile. Counting it would make the budget a test of router warmth.
  await probeOnce(url);

  const samples = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < REQUESTS) {
      const i = cursor++;
      if (i >= REQUESTS) break;
      samples.push(await probeOnce(url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, REQUESTS) }, worker));

  const ok = samples.filter((s) => s.status === ep.expect && !s.error);
  const bad = samples.filter((s) => s.status !== ep.expect || s.error);
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);

  return {
    ...ep,
    url,
    total: samples.length,
    okCount: ok.length,
    errorCount: bad.length,
    statuses: Array.from(new Set(samples.map((s) => s.error || String(s.status)))).join(','),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    mean: mean(latencies),
    slowest: latencies[latencies.length - 1] ?? NaN,
  };
}

function verdictFor(r) {
  const reasons = [];
  if (r.errorCount > MAX_ERRORS) reasons.push(`${r.errorCount} unexpected response(s) [${r.statuses}]`);
  if (!(r.p95 <= P95_BUDGET_MS)) reasons.push(`p95 ${r.p95.toFixed(0)}ms > budget ${P95_BUDGET_MS}ms`);
  if (!(r.p50 <= P50_BUDGET_MS)) reasons.push(`p50 ${r.p50.toFixed(0)}ms > budget ${P50_BUDGET_MS}ms`);
  return { pass: reasons.length === 0, reasons };
}

async function main() {
  let target;
  try {
    target = resolveTarget();
  } catch (err) {
    if (err instanceof TargetError) {
      console.error(`::error::perf-smoke target is unusable: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const deployed = await fetchDeployedBuild(target.api);
  const buildVerdict = announceTarget(target, deployed, process.env.GITHUB_SHA || process.env.PERF_EXPECTED_SHA);

  console.log(
    `\n── perf smoke ── ${REQUESTS} measured requests/endpoint, ${CONCURRENCY} in flight, ` +
      `budget p50<=${P50_BUDGET_MS}ms p95<=${P95_BUDGET_MS}ms, max ${MAX_ERRORS} error(s)\n`,
  );

  const results = [];
  for (const ep of ENDPOINTS) {
    const r = await probeEndpoint(ep, target);
    const v = verdictFor(r);
    results.push({ ...r, ...v });
    const mark = v.pass ? 'PASS' : 'FAIL';
    console.log(
      `  ${mark}  ${r.label.padEnd(30)} p50=${r.p50.toFixed(0).padStart(5)}ms ` +
        `p95=${r.p95.toFixed(0).padStart(5)}ms max=${r.slowest.toFixed(0).padStart(5)}ms ` +
        `errors=${r.errorCount}/${r.total}  [${r.layer}]` +
        (v.pass ? '' : `\n        ↳ ${v.reasons.join('; ')}`),
    );
  }

  const failed = results.filter((r) => !r.pass);
  const slowest = results.reduce((a, b) => (b.p95 > a.p95 ? b : a), results[0]);

  const summary = [
    '### Performance smoke',
    '',
    `Target: \`${target.api}\` — deployed commit \`${deployed.ok ? deployed.commit.slice(0, 12) : 'unknown'}\` (build verdict: **${buildVerdict}**)`,
    '',
    '| endpoint | layer | p50 | p95 | max | errors | verdict |',
    '|---|---|---:|---:|---:|---:|---|',
    ...results.map(
      (r) =>
        `| \`${r.label.trim()}\` | ${r.layer} | ${r.p50.toFixed(0)}ms | ${r.p95.toFixed(0)}ms | ` +
        `${r.slowest.toFixed(0)}ms | ${r.errorCount}/${r.total} | ${r.pass ? 'PASS' : '**FAIL**'} |`,
    ),
    '',
    `Budget: p50 <= ${P50_BUDGET_MS}ms, p95 <= ${P95_BUDGET_MS}ms, errors <= ${MAX_ERRORS}. ` +
      `${REQUESTS} measured requests per endpoint after one unmeasured warm-up.`,
    '',
    '> This is a smoke, not a load test. The k6 suites in `tools/loadtest/` (200-VU ramp, ' +
    '> p95 < 250ms per the marketplace PRD) remain the pre-go-live load gate — ' +
    '> `make marketplace-loadtest`. See `docs/qa/TEST_PLAN.md` §7.',
  ].join('\n');
  writeStepSummary(summary);

  if (failed.length) {
    console.log(
      `\n::error title=Performance smoke failed::${failed.length}/${results.length} endpoint(s) breached the budget: ` +
        failed.map((f) => `${f.label.trim()} (${f.reasons.join('; ')})`).join(' | '),
    );
    process.exit(1);
  }
  console.log(`\nAll ${results.length} endpoints within budget. Slowest p95: ${slowest.label.trim()} at ${slowest.p95.toFixed(0)}ms.`);
}

main().catch((err) => {
  console.error(`::error::perf-smoke crashed: ${err.stack || err.message}`);
  process.exit(2);
});
