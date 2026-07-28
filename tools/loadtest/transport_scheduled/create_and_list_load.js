// tools/loadtest/transport_scheduled/create_and_list_load.js
//
// k6 load test for the transport-scheduling member surface
// (SWARM_INTEGRATION_CONTRACT.md §"FROZEN HTTP ROUTES", member group):
//   POST /api/finance/mobility/scheduled            (Idempotency-Key required)
//   GET  /api/finance/mobility/scheduled?filter=upcoming|past|all
//
// This mirrors the house pattern in tools/loadtest/marketplace/checkout_mutation_load.js:
// each VU iteration (1) creates a scheduled booking with a fresh Idempotency-Key,
// (2) REPLAYS the exact same create call with the SAME key and asserts the
// response is byte-identical (id + status unchanged) — a cheap, load-test-time
// proxy for "CreateScheduled ON CONFLICT (idempotency_key) DO NOTHING returns
// the existing booking, never a duplicate row" — and (3) lists the caller's
// bookings and asserts the just-created booking appears exactly once.
//
// It CANNOT inspect transport_scheduled_bookings directly (that needs DB
// access — see QA_REPORT.md for the live-DB test that does), but a changed
// booking id/status on replay, or the booking appearing twice in the list, is
// an instant, loud signal that idempotency broke under concurrency.
//
// PRE-REQUISITES this script assumes are already true in the target
// environment (seed data / config, not part of this script):
//   - FEATURE_TRANSPORT_SCHEDULING_ENABLED=true
//   - Each test rider JWT belongs to a user who can pass CreateScheduled's
//     validation guards (no wallet balance is required at CREATE time — per
//     the contract, escrow happens at DISPATCH, not at booking — so this
//     script is safe to run without seeding a wallet)
//   - RIDER_TOKENS supplies one JWT per virtual "rider" so concurrent VUs use
//     distinct callers (avoids every VU hammering one user's list endpoint)
//
// Usage:
//   k6 run \
//     -e BASE_URL=https://staging.paymax.example \
//     -e RIDER_TOKENS=$JWT1,$JWT2,$JWT3 \
//     create_and_list_load.js
//
//   k6 run -e BASE_URL=http://localhost:8080 -e RIDER_TOKENS=$TOKEN create_and_list_load.js

import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const RIDER_TOKENS = (__ENV.RIDER_TOKENS || '').split(',').filter(Boolean);
const MARKET_ID = __ENV.MARKET_ID || 'NG';

const idempotencyReplayMismatch = new Counter('sched_idempotency_replay_mismatch');
const createFailures = new Counter('sched_create_failures');
const listFailures = new Counter('sched_list_failures');
const bookingMissingFromList = new Counter('sched_booking_missing_from_list');
const bookingDuplicatedInList = new Counter('sched_booking_duplicated_in_list');

export const options = {
  scenarios: {
    scheduled_create_and_list: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 10 },  // warm-up
        { duration: '1m', target: 40 },   // steady mutation + read load
        { duration: '30s', target: 60 },  // burst
        { duration: '20s', target: 0 },   // cool-down
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    'http_req_duration{name:POST /api/finance/mobility/scheduled}': ['p(95)<400'],
    'http_req_duration{name:GET /api/finance/mobility/scheduled}': ['p(95)<300'],
    http_req_failed: ['rate<0.02'],
    sched_idempotency_replay_mismatch: ['count==0'], // ANY mismatch is a P0 money-adjacent bug
    sched_booking_duplicated_in_list: ['count==0'],  // a duplicate row would show up here
    checks: ['rate>0.98'],
  },
};

// The 6 frozen modes (SWARM_INTEGRATION_CONTRACT §"Product decisions"),
// weighted toward the two most common (ride_hail, parcel_intra) with the
// others as a representative minority mix.
const MODE_WEIGHTS = [
  { mode: 'ride_hail', weight: 0.4 },
  { mode: 'ride_share', weight: 0.15 },
  { mode: 'parcel_intra', weight: 0.2 },
  { mode: 'parcel_inter', weight: 0.1 },
  { mode: 'airport_pickup', weight: 0.1 },
  { mode: 'bus', weight: 0.05 },
];

function pickMode() {
  const r = Math.random();
  let cum = 0;
  for (const m of MODE_WEIGHTS) {
    cum += m.weight;
    if (r <= cum) return m.mode;
  }
  return 'ride_hail';
}

function modePayloadFor(mode) {
  switch (mode) {
    case 'parcel_intra':
    case 'parcel_inter':
      return { receiver_name: 'Load Test Receiver', receiver_phone: '08000000000', size: 'small', speed: 'standard' };
    case 'airport_pickup':
      return { flight_number: 'LT123', terminal: 'MMA2' };
    case 'bus':
      return { schedule_id: __ENV.BUS_SCHEDULE_ID || '', seat_number: 1 + Math.floor(Math.random() * 40) };
    default:
      return { pricing_mode: 'instant' };
  }
}

// futurePickupISO returns an RFC3339 timestamp 2-72h in the future so every
// created booking passes the PICKUP_IN_PAST guard with margin, spread across a
// representative scheduling horizon (not everyone books for "in 2 hours").
function futurePickupISO() {
  const hoursOut = 2 + Math.random() * 70;
  return new Date(Date.now() + hoursOut * 3600 * 1000).toISOString();
}

function headersFor(token, idemKey) {
  const h = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Market-Id': MARKET_ID,
  };
  if (idemKey) h['Idempotency-Key'] = idemKey;
  return h;
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
    fail('RIDER_TOKENS env var is required (comma-separated JWTs for distinct test riders)');
  }
  const token = RIDER_TOKENS[Math.floor(Math.random() * RIDER_TOKENS.length)];
  const mode = pickMode();

  const createBody = JSON.stringify({
    mode,
    scheduled_pickup_at: futurePickupISO(),
    pickup: { label: 'Load-test pickup', lat: 6.5244 + (Math.random() - 0.5) * 0.2, lng: 3.3792 + (Math.random() - 0.5) * 0.2 },
    dropoff: { label: 'Load-test dropoff', lat: 6.4281 + (Math.random() - 0.5) * 0.2, lng: 3.4219 + (Math.random() - 0.5) * 0.2 },
    mode_payload: modePayloadFor(mode),
    payment_method: 'wallet',
  });

  // ── Step 1: POST /scheduled (Idempotency-Key K) ────────────────────────────
  const createKey = uuidv4();
  const createRes = http.post(`${BASE_URL}/api/finance/mobility/scheduled`, createBody, {
    headers: headersFor(token, createKey),
    tags: { name: 'POST /api/finance/mobility/scheduled' },
  });

  const created = check(createRes, {
    'create: status 201': (r) => r.status === 201,
    'create: has booking id': (r) => {
      const b = bodyOf(r);
      return !!(b && b.id);
    },
  });
  if (!created) {
    createFailures.add(1);
    sleep(1);
    return;
  }
  const booking1 = bodyOf(createRes);

  // ── Step 2: REPLAY the exact same create with the SAME Idempotency-Key ────
  // CreateScheduled's ON CONFLICT (idempotency_key) DO NOTHING + byIdempotencyKey
  // fallback must return the IDENTICAL booking, not a second row.
  const replayRes = http.post(`${BASE_URL}/api/finance/mobility/scheduled`, createBody, {
    headers: headersFor(token, createKey),
    tags: { name: 'POST /api/finance/mobility/scheduled' },
  });
  check(replayRes, {
    'create replay: status 200 or 201 (idempotent replay is valid either way)': (r) => r.status === 200 || r.status === 201,
  });
  const booking2 = bodyOf(replayRes);
  if (!booking2 || booking2.id !== booking1.id || booking2.status !== booking1.status) {
    idempotencyReplayMismatch.add(1);
    console.error(
      `IDEMPOTENCY MISMATCH first=${JSON.stringify(booking1)} replay=${JSON.stringify(booking2)}`
    );
  }

  sleep(0.3);

  // ── Step 3: GET /scheduled?filter=upcoming and confirm the booking is there
  // EXACTLY ONCE (no duplicate row from the create+replay pair above). ───────
  const listRes = http.get(`${BASE_URL}/api/finance/mobility/scheduled?filter=upcoming&limit=100`, {
    headers: headersFor(token),
    tags: { name: 'GET /api/finance/mobility/scheduled' },
  });
  const listed = check(listRes, {
    'list: status 200': (r) => r.status === 200,
    'list: has bookings array': (r) => {
      const b = bodyOf(r);
      return !!(b && Array.isArray(b.bookings));
    },
  });
  if (!listed) {
    listFailures.add(1);
    sleep(1);
    return;
  }
  const listBody = bodyOf(listRes);
  const matches = (listBody.bookings || []).filter((b) => b.id === booking1.id);
  if (matches.length === 0) {
    bookingMissingFromList.add(1);
    console.error(`booking ${booking1.id} created but missing from upcoming list`);
  } else if (matches.length > 1) {
    bookingDuplicatedInList.add(1);
    console.error(`booking ${booking1.id} appears ${matches.length} times in upcoming list (duplicate row?)`);
  }

  sleep(Math.random() * 2 + 1); // 1-3s think time between scheduling actions
}
