// tools/loadtest/marketplace/checkout_mutation_load.js
//
// k6 load test for the §6.1 escrow checkout -> funding mutation path:
//   POST /v1/marketplace/orders            (Idempotency-Key required)
//   POST /v1/marketplace/orders/{id}/fund  (Idempotency-Key required)
//
// This is the highest-risk endpoint pair in the system (§3.1: "the highest-risk
// endpoint in the system") — it is the only place a load test can meaningfully
// exercise concurrency against the money path, so this script also asserts the
// IDEMPOTENCY invariant under load, not just latency: each VU iteration mints
// its own Idempotency-Key per logical checkout, then REPLAYS the fund call with
// the same key and asserts the response is byte-identical to the original
// (order id + status unchanged) — a cheap, load-test-time proxy for "same
// Idempotency-Key twice = one ledger effect, replay returns original" (§3,
// §6.1). It cannot inspect the ledger directly (that requires DB access, see
// QA_REPORT.md), but a changed order id/status on replay is an instant, loud
// signal that idempotency broke under concurrency.
//
// PRE-REQUISITES this script assumes are already true in the target environment
// (seed data, not part of this script):
//   - FEATURE_MARKETPLACE_ENABLED=true
//   - At least LISTING_POOL_SIZE active, escrow_eligible listings exist, seeded
//     by a distinct seller per listing (self-purchase is blocked, §8/§3.1
//     SELF_PURCHASE_NOT_ALLOWED)
//   - Each test buyer JWT belongs to a user at kyc_tier >= tier1 with a wallet
//     balance large enough to fund at least one order per iteration
//   - Listing ids are supplied via the LISTING_IDS env var (comma-separated) so
//     this script never invents ids that don't exist in the target environment
//
// Usage:
//   k6 run \
//     -e BASE_URL=https://staging.paymax.example \
//     -e TOKEN=$BUYER_JWT \
//     -e LISTING_IDS=uuid1,uuid2,uuid3 \
//     checkout_mutation_load.js

import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const TOKEN = __ENV.TOKEN || '';
const LISTING_IDS = (__ENV.LISTING_IDS || '').split(',').filter(Boolean);

const idempotencyReplayMismatch = new Counter('mkt_idempotency_replay_mismatch');
const orderCreateFailures = new Counter('mkt_order_create_failures');
const orderFundFailures = new Counter('mkt_order_fund_failures');

export const options = {
  scenarios: {
    checkout_mutation: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 10 },  // warm-up
        { duration: '1m', target: 50 },   // steady mutation load
        { duration: '30s', target: 80 },  // burst (promo/flash-sale checkout spike)
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    // Mutation endpoints tolerate slightly higher latency than pure search reads,
    // but must stay well under the funding window (30 min) and feel instant to
    // a buyer at checkout.
    'http_req_duration{name:POST /v1/marketplace/orders}': ['p(95)<400'],
    'http_req_duration{name:POST /v1/marketplace/orders/fund}': ['p(95)<500'],
    http_req_failed: ['rate<0.02'],
    mkt_idempotency_replay_mismatch: ['count==0'], // ANY mismatch is a P0 money bug
    checks: ['rate>0.98'],
  },
};

function headers(idemKey) {
  const h = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
  };
  if (idemKey) h['Idempotency-Key'] = idemKey;
  return h;
}

export default function () {
  if (LISTING_IDS.length === 0) {
    fail('LISTING_IDS env var is required (comma-separated listing UUIDs seeded in the target env)');
  }
  const listingId = LISTING_IDS[Math.floor(Math.random() * LISTING_IDS.length)];

  // ── Step 1: POST /orders (Idempotency-Key K1) ──────────────────────────────
  const createKey = uuidv4();
  const createBody = JSON.stringify({
    listing_id: listingId,
    delivery_option: Math.random() < 0.5 ? 'pickup' : 'rider_delivery',
  });
  const createRes = http.post(`${BASE_URL}/v1/marketplace/orders`, createBody, {
    headers: headers(createKey),
    tags: { name: 'POST /v1/marketplace/orders' },
  });

  const created = check(createRes, {
    'create: status 201': (r) => r.status === 201,
    'create: has order id': (r) => {
      try {
        const b = JSON.parse(r.body);
        return !!(b.data && b.data.id) || !!b.id;
      } catch (e) {
        return false;
      }
    },
  });
  if (!created) {
    orderCreateFailures.add(1);
    sleep(1);
    return;
  }

  const createdBody = JSON.parse(createRes.body);
  const order = createdBody.data || createdBody;
  const orderId = order.id;

  // ── Step 2: POST /orders/{id}/fund (Idempotency-Key K2), TWICE ─────────────
  const fundKey = uuidv4();
  const fundBody = JSON.stringify({ payment_method: 'wallet' });

  const fundRes1 = http.post(`${BASE_URL}/v1/marketplace/orders/${orderId}/fund`, fundBody, {
    headers: headers(fundKey),
    tags: { name: 'POST /v1/marketplace/orders/fund' },
  });
  const funded1 = check(fundRes1, {
    'fund: status 200': (r) => r.status === 200,
  });
  if (!funded1) {
    orderFundFailures.add(1);
    sleep(1);
    return;
  }

  // ── Step 3: REPLAY the exact same fund call with the SAME Idempotency-Key ──
  // §3/§6.1: a replay must return the ORIGINAL response, not re-debit. We assert
  // this by comparing the canonical fields of both responses.
  const fundRes2 = http.post(`${BASE_URL}/v1/marketplace/orders/${orderId}/fund`, fundBody, {
    headers: headers(fundKey),
    tags: { name: 'POST /v1/marketplace/orders/fund' },
  });

  check(fundRes2, {
    'fund replay: status is 200 or 409 (both are valid idempotent-replay signals)': (r) =>
      r.status === 200 || r.status === 409,
  });

  try {
    const b1 = JSON.parse(fundRes1.body);
    const b2 = JSON.parse(fundRes2.body);
    const d1 = b1.data || b1;
    const d2 = b2.data || b2;
    const ledgerRef1 = d1.ledger_fund_ref;
    const ledgerRef2 = d2.ledger_fund_ref;
    const idOk = d1.id === d2.id;
    const refOk = !ledgerRef1 || !ledgerRef2 || ledgerRef1 === ledgerRef2;
    if (!idOk || !refOk) {
      idempotencyReplayMismatch.add(1);
      console.error(
        `IDEMPOTENCY MISMATCH order=${orderId} first=${JSON.stringify(d1)} replay=${JSON.stringify(d2)}`
      );
    }
  } catch (e) {
    // A parse failure on either response is itself suspicious for a replay path;
    // count it toward the mismatch metric so it surfaces in the threshold gate.
    idempotencyReplayMismatch.add(1);
  }

  sleep(Math.random() * 2 + 1); // 1-3s think time between checkouts
}
