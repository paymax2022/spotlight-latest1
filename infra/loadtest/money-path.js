// k6 load test for the money-path surface. Run against STAGING only.
//
//   BASE_URL=https://paymax-backend-xxx.run.app \
//   AUTH_TOKEN=<staging supabase JWT> \
//   k6 run infra/loadtest/money-path.js
//
// Thresholds mirror the launch SLOs (docs/launch/SUPER-APP-LAUNCH-BLUEPRINT.md §11):
// p95 < 400ms, error rate < 0.5%. The run fails if they're breached, so this can
// gate a pre-launch load sign-off. Tune stages to your expected launch volume.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errors = new Rate('money_path_errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // ramp up
    { duration: '3m', target: 200 },  // sustained (set to expected launch peak)
    { duration: '1m', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<400'],
    money_path_errors: ['rate<0.005'],
    http_req_failed: ['rate<0.01'],
  },
};

const authHeaders = AUTH_TOKEN
  ? { Authorization: `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' }
  : { 'Content-Type': 'application/json' };

export default function () {
  // 1. Liveness/readiness — should always be fast + green.
  const health = http.get(`${BASE_URL}/healthz`);
  check(health, { 'healthz 200': (r) => r.status === 200 }) || errors.add(1);

  // 2. Authenticated read on the money surface (wallet balance). Without a token
  //    this returns 401 (still exercises auth + routing); with one it exercises
  //    the real read path. Swap for your representative read.
  const wallet = http.get(`${BASE_URL}/api/v1/wallet/balance`, { headers: authHeaders });
  check(wallet, { 'wallet not 5xx': (r) => r.status < 500 }) || errors.add(1);

  // NOTE: do NOT load-test money MUTATIONS (fund/transfer/payout) against live
  // provider rails. If you must, use provider SANDBOX creds + unique
  // Idempotency-Keys per iteration, and a dedicated staging wallet.

  sleep(1);
}
