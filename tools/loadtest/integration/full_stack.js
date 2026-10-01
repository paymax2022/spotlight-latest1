// tools/loadtest/integration/full_stack.js
//
// Multi-group integration load test against the assembled local stack:
//   Next.js :3000 → Go API :8080 → Postgres :54322 / Redis :6380 / GoTrue :54321
//
// User groups (same running system, per the integration-env plan):
//   auth_churn  — signup/login path: POST /api/auth/login (loginLimiter applies)
//   browse      — public reads: contests list, /readyz
//   wallet      — authed money reads: /api/auth/me, wallet balance, history
//   frontend    — Next.js surface: page load + its /api/auth/me proxy route
//   dup_storm   — same request fired repeatedly (duplicate/retry behaviour)
//
// Usage:
//   k6 run -e GO_BASE=http://localhost:8080 -e WEB_BASE=http://localhost:3000 \
//          -e USERS=200 tools/loadtest/integration/full_stack.js
//
// Loadtest users loadtest-NNN@spotlight.internal / LoadTest123! are created by
// tools/dev/seed-loadtest-users.sh (GoTrue admin API).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const GO_BASE = __ENV.GO_BASE || 'http://localhost:8080';
const WEB_BASE = __ENV.WEB_BASE || 'http://localhost:3000';
const USERS = parseInt(__ENV.USERS || '200', 10);
const PASSWORD = 'LoadTest123!';

const loginFailures = new Rate('login_failures');
const loginRateLimited = new Rate('login_rate_limited');
const authedFailures = new Rate('authed_failures');
const publicFailures = new Rate('public_failures');
const frontendFailures = new Rate('frontend_failures');
const loginLatency = new Trend('login_latency_ms', true);

function email(i) {
  return `loadtest-${String((i % USERS) + 1).padStart(3, '0')}@spotlight.internal`;
}

// Token cache per VU — login once, reuse (mirrors a real session).
let token = null;
function ensureLogin(vuId) {
  if (token) return token;
  const res = http.post(
    `${GO_BASE}/api/auth/login`,
    JSON.stringify({ email: email(vuId), password: PASSWORD }),
    // 429 = loginLimiter engaging per source IP — expected under a
    // single-IP load generator, not a failure.
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' },
      responseCallback: http.expectedStatuses(200, 429) },
  );
  loginLatency.add(res.timings.duration);
  loginRateLimited.add(res.status === 429);
  const ok = check(res, { 'login 200': (r) => r.status === 200 });
  loginFailures.add(res.status !== 200 && res.status !== 429);
  if (ok) {
    try { token = res.json('session.access_token'); } catch { token = null; }
  }
  return token;
}

const authed = (path, tags) =>
  http.get(`${GO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: tags || {},
  });

export const options = {
  scenarios: {
    auth_churn: {
      executor: 'constant-vus', vus: 15, duration: '2m',
      exec: 'authChurn', startTime: '0s',
    },
    browse: {
      executor: 'ramping-vus', startVUs: 0, exec: 'browse',
      stages: [
        { duration: '30s', target: 40 },
        { duration: '60s', target: 80 },
        { duration: '30s', target: 0 },
      ], startTime: '0s',
    },
    wallet: {
      executor: 'ramping-vus', startVUs: 0, exec: 'wallet',
      stages: [
        { duration: '30s', target: 30 },
        { duration: '60s', target: 60 },
        { duration: '30s', target: 0 },
      ], startTime: '10s',
    },
    frontend: {
      executor: 'constant-vus', vus: 10, duration: '2m',
      exec: 'frontend', startTime: '20s',
    },
    dup_storm: {
      executor: 'constant-vus', vus: 10, duration: '1m',
      exec: 'dupStorm', startTime: '45s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'login_latency_ms': ['p(95)<3000'],
    'http_req_duration{name:login}': ['p(95)<3000'],
    'http_req_duration{name:public_health}': ['p(95)<1500'],
    'http_req_duration{name:wallet_balance}': ['p(95)<1500'],
  },
};

export function authChurn() {
  // Force fresh login every iteration: this group stresses GoTrue + the
  // platform_users lockout gate + loginLimiter.
  token = null;
  const vu = __VU + Math.floor(Math.random() * USERS);
  ensureLogin(vu);
  sleep(0.5 + Math.random());
}

export function browse() {
  // /api/v1/registration/contests requires auth — the real anonymous surface is
  // the public health/build endpoints plus the Next.js homepage.
  const r1 = http.get(`${GO_BASE}/api/v1/public/health`, { tags: { name: 'public_health' } });
  publicFailures.add(!check(r1, { 'public health ok': (r) => r.status === 200 }));
  const r2 = http.get(`${GO_BASE}/readyz`, { tags: { name: 'readyz' } });
  check(r2, { 'readyz 200': (r) => r.status === 200 });
  sleep(0.3 + Math.random() * 0.7);
}

export function wallet() {
  if (!ensureLogin(__VU)) { sleep(1); return; }
  let r = authed('/api/auth/me');
  authedFailures.add(!check(r, { 'me ok': (x) => x.status === 200 }));
  r = authed('/api/finance/wallet/balance', { name: 'wallet_balance' });
  authedFailures.add(!check(r, { 'balance ok': (x) => x.status === 200 }));
  r = authed('/api/v1/wallet/summary');
  authedFailures.add(!check(r, { 'summary ok': (x) => [200, 404].includes(x.status) }));
  sleep(0.4 + Math.random() * 0.6);
}

export function frontend() {
  const r1 = http.get(`${WEB_BASE}/`, { tags: { name: 'web_home' } });
  frontendFailures.add(!check(r1, { 'home ok': (x) => x.status === 200 }));
  sleep(0.8 + Math.random());
}

export function dupStorm() {
  // Same login payload hammered back-to-back from one VU — exercises the
  // loginLimiter and any dedup behaviour on the auth path.
  const vu = 5000 + __VU;
  for (let i = 0; i < 5; i++) {
    const res = http.post(
      `${GO_BASE}/api/auth/login`,
      JSON.stringify({ email: email(vu), password: PASSWORD }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login_dup' },
        responseCallback: http.expectedStatuses(200, 401, 429) },
    );
    check(res, { 'dup login answered': (r) => [200, 401, 429].includes(r.status) });
  }
  sleep(0.2);
}
