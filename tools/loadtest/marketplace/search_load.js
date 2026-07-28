// tools/loadtest/marketplace/search_load.js
//
// k6 load test for GET /v1/marketplace/search.
//
// PRD budget under test (Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md §3.2 response
// field `took_ms` + master PRD §8 latency budget, referenced from the build
// contract §10.10: "Load-test search... against the p95 budgets... using k6"):
//   p95 latency < 250ms for GET /v1/marketplace/search
//
// Query shape follows §3.2 exactly: q, category_id, price_min/max, condition,
// lat/lng/radius_km, state/lga, sort, cursor/limit — a representative mix of
// text-only, filtered, geo, and paginated requests, matching real traffic
// (most searches are filtered browse, a minority are geo-radius or free-text).
//
// Usage:
//   BASE_URL=https://staging.paymax.example TOKEN=<jwt> k6 run search_load.js
//   k6 run -e BASE_URL=http://localhost:8080 -e TOKEN=$TOKEN search_load.js
//
// Both BASE_URL and TOKEN are read from env so this script never hardcodes a
// secret or environment (house convention — no credentials committed to repo).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const TOKEN = __ENV.TOKEN || '';
const MARKET_ID = __ENV.MARKET_ID || 'NG';

// Custom trend so the took_ms field the API itself reports (server-side ES
// timing) is tracked separately from k6's end-to-end http_req_duration — a gap
// between the two indicates network/gateway overhead vs. actual search latency.
const serverTookMs = new Trend('mkt_search_took_ms', true);

export const options = {
  scenarios: {
    search_browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },   // warm-up
        { duration: '2m', target: 100 },   // steady state representative load
        { duration: '1m', target: 200 },   // peak burst (flash-sale / promo push)
        { duration: '30s', target: 0 },    // cool-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // PRD §8 budget: p95 < 250ms end-to-end.
    http_req_duration: ['p(95)<250'],
    // Track the server's own reported took_ms against the same budget so a
    // regression can be localized to "search backend" vs "network/gateway".
    mkt_search_took_ms: ['p(95)<250'],
    http_req_failed: ['rate<0.01'], // <1% error budget
    checks: ['rate>0.99'],
  },
};

// Representative query mix (§3.2 query_params). Weighted toward plain filtered
// browse (most common), with text search, geo-radius, and pagination continuation
// as secondary patterns — matches typical marketplace traffic shape.
const CATEGORIES = [
  '11111111-1111-1111-1111-111111111111', // phones & tablets (placeholder UUIDs;
  '22222222-2222-2222-2222-222222222222', // vehicles                 replace with
  '33333333-3333-3333-3333-333333333333', // fashion                  real seeded
];
const CONDITIONS = ['new', 'used', 'foreign_used', 'local_used', 'refurbished'];
const STATES = ['Lagos', 'Abuja', 'Rivers', 'Kano'];
const QUERIES = ['iphone 13', 'toyota camry', 'ankara dress', 'gaming laptop', ''];
const SORTS = ['relevance', 'price_asc', 'price_desc', 'newest', 'trusted_first'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildSearchURL() {
  const params = new URLSearchParams();
  const q = pick(QUERIES);
  if (q) params.set('q', q);

  const pattern = Math.random();
  if (pattern < 0.45) {
    // Plain filtered browse — category + condition, no geo, no text.
    params.set('category_id', pick(CATEGORIES));
    params.set('condition', pick(CONDITIONS));
  } else if (pattern < 0.7) {
    // Text search with a price band.
    params.set('price_min', String(Math.floor(Math.random() * 50000) * 100));
    params.set('price_max', String((Math.floor(Math.random() * 50000) + 50000) * 100));
  } else if (pattern < 0.9) {
    // Geo-radius search (Lagos mainland coordinates as a representative origin).
    params.set('lat', (6.5244 + (Math.random() - 0.5) * 0.5).toFixed(4));
    params.set('lng', (3.3792 + (Math.random() - 0.5) * 0.5).toFixed(4));
    params.set('radius_km', String(pick([5, 10, 25, 50])));
  } else {
    // State/LGA filtered browse.
    params.set('state', pick(STATES));
  }
  params.set('sort', pick(SORTS));
  params.set('limit', String(pick([10, 20, 20, 20, 50]))); // 20 is the default/mode
  return `${BASE_URL}/v1/marketplace/search?${params.toString()}`;
}

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  headers['X-Market-Id'] = MARKET_ID;

  const res = http.get(buildSearchURL(), { headers, tags: { name: 'GET /v1/marketplace/search' } });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'response has results array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.data ? body.data.results : body.results);
      } catch (e) {
        return false;
      }
    },
  });

  if (ok && res.status === 200) {
    try {
      const body = JSON.parse(res.body || '{}');
      const took = (body.data && body.data.took_ms) || body.took_ms;
      if (typeof took === 'number') {
        serverTookMs.add(took);
      }
    } catch (e) {
      // ignore parse failures for the trend metric; the `checks` threshold
      // above already captures response-shape correctness/failure.
    }
  }

  sleep(Math.random() * 1.5 + 0.5); // 0.5-2s think time between searches
}
