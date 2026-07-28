// tools/loadtest/transport_scheduled/list_read_load.js
//
// k6 load test for GET /api/finance/mobility/scheduled (pure read path,
// keyset-paginated). Complements create_and_list_load.js, which exercises the
// create+replay+list sequence at moderate concurrency; this script isolates
// the LIST endpoint at higher read concurrency to characterize its own
// latency budget independent of the write path (mirrors the house pattern in
// tools/loadtest/marketplace/search_load.js).
//
// Query shape follows the frozen route exactly (SWARM_INTEGRATION_CONTRACT.md
// §"FROZEN HTTP ROUTES": GET /scheduled?filter=upcoming|past|all&cursor&limit),
// with a representative mix of filters and page sizes, and a cursor-continuation
// pattern (fetch page 1, then use nextCursor for page 2) to exercise the
// keyset-pagination path, not just first-page reads.
//
// PRE-REQUISITES:
//   - FEATURE_TRANSPORT_SCHEDULING_ENABLED=true
//   - RIDER_TOKENS supplies one or more JWTs for users who already have some
//     scheduled bookings seeded (run create_and_list_load.js first, or seed
//     directly) — an empty list still exercises the endpoint but won't
//     meaningfully test pagination.
//
// Usage:
//   k6 run -e BASE_URL=http://localhost:8080 -e RIDER_TOKENS=$JWT list_read_load.js

import http from 'k6/http';
import { check, sleep, fail } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const RIDER_TOKENS = (__ENV.RIDER_TOKENS || '').split(',').filter(Boolean);
const MARKET_ID = __ENV.MARKET_ID || 'NG';

const FILTERS = ['upcoming', 'past', 'all'];
const LIMITS = [10, 20, 20, 50, 100]; // 20 weighted as the common page size

export const options = {
  scenarios: {
    scheduled_list_read: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 20 },   // warm-up
        { duration: '2m', target: 120 },   // steady-state read load
        { duration: '30s', target: 200 },  // burst (e.g. admin ops board polling + app opens)
        { duration: '20s', target: 0 },    // cool-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'http_req_duration{name:GET /api/finance/mobility/scheduled}': ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function headersFor(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Market-Id': MARKET_ID,
  };
}

function bodyOf(res) {
  try {
    const b = JSON.parse(res.body);
    return b.data || b;
  } catch (e) {
    return null;
  }
}

export default function () {
  if (RIDER_TOKENS.length === 0) {
    fail('RIDER_TOKENS env var is required (comma-separated JWTs)');
  }
  const token = RIDER_TOKENS[Math.floor(Math.random() * RIDER_TOKENS.length)];
  const filter = pick(FILTERS);
  const limit = pick(LIMITS);

  // ── Page 1 ──────────────────────────────────────────────────────────────
  const page1Res = http.get(
    `${BASE_URL}/api/finance/mobility/scheduled?filter=${filter}&limit=${limit}`,
    { headers: headersFor(token), tags: { name: 'GET /api/finance/mobility/scheduled' } }
  );
  const page1Ok = check(page1Res, {
    'page1: status 200': (r) => r.status === 200,
    'page1: has bookings array': (r) => {
      const b = bodyOf(r);
      return !!(b && Array.isArray(b.bookings));
    },
  });
  if (!page1Ok) {
    sleep(1);
    return;
  }
  const page1 = bodyOf(page1Res);

  sleep(0.2);

  // ── Page 2 via cursor continuation (exercises keyset pagination) ─────────
  if (page1.nextCursor) {
    const page2Res = http.get(
      `${BASE_URL}/api/finance/mobility/scheduled?filter=${filter}&limit=${limit}&cursor=${encodeURIComponent(page1.nextCursor)}`,
      { headers: headersFor(token), tags: { name: 'GET /api/finance/mobility/scheduled' } }
    );
    check(page2Res, {
      'page2 (cursor continuation): status 200': (r) => r.status === 200,
      'page2: does not repeat page1 first item': (r) => {
        const b2 = bodyOf(r);
        if (!b2 || !Array.isArray(b2.bookings) || b2.bookings.length === 0) return true; // empty page2 is fine
        if (!page1.bookings || page1.bookings.length === 0) return true;
        return b2.bookings[0].id !== page1.bookings[0].id;
      },
    });
  }

  sleep(Math.random() * 1 + 0.3); // 0.3-1.3s think time between list reads
}
