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
//   - Rider identities supplied either as static JWTs (RIDER_TOKENS) or as
//     credentials (RIDER_CREDENTIALS). Riders should already have some
//     scheduled bookings seeded (run create_and_list_load.js first, or seed
//     directly) — an empty list still exercises the endpoint but won't
//     meaningfully test pagination.
//
// TOKEN REFRESH (AUD-TEST-009):
//   RIDER_TOKENS are GoTrue access JWTs with a ~1h exp; on longer runs they
//   used to expire mid-run and every subsequent request 401'd (observed:
//   7,319x401 out of 14,462 reqs after expiry). Two ways this script now
//   keeps tokens fresh:
//     - RIDER_CREDENTIALS="email1:pass1,email2:pass2" — when set, each VU
//       re-logs-in via LOGIN_PATH (default POST /api/auth/login, response
//       shape {session:{access_token, expires_in, expires_at}}) whenever the
//       cached token's exp is inside TOKEN_REFRESH_SKEW_SEC, and retries once
//       on a 401. If RIDER_TOKENS[i] is also given it seeds rider i's cache,
//       so an already-expired static token self-heals on first use.
//     - Without RIDER_CREDENTIALS the static tokens are used as before
//       (backward compatible), with one warning in setup() that they cannot
//       be refreshed.
//   LOGIN_PATH is an env var (not hardcoded) so the same script works against
//   stacks that front auth differently.
//
// Usage:
//   # static tokens (short runs)
//   k6 run -e BASE_URL=http://localhost:8080 -e RIDER_TOKENS=$JWT list_read_load.js
//   # self-refreshing (long runs) — pairs with tools/loadtest/integration/seed-users.sh
//   k6 run -e BASE_URL=http://localhost:8080 \
//          -e RIDER_CREDENTIALS='loadtest-001@spotlight.internal:LoadTest123!' \
//          list_read_load.js

import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Counter } from 'k6/metrics';
import encoding from 'k6/encoding';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const RIDER_TOKENS = (__ENV.RIDER_TOKENS || '').split(',').filter(Boolean);
const MARKET_ID = __ENV.MARKET_ID || 'NG';

// Comma-separated "email:password" pairs. Split on the FIRST ':' so passwords
// containing ':' still parse; emails never contain one.
function parseCredentials(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(':');
      if (i <= 0) return null;
      return { email: pair.slice(0, i), password: pair.slice(i + 1) };
    })
    .filter(Boolean);
}

const RIDER_CREDENTIALS = parseCredentials(__ENV.RIDER_CREDENTIALS || '');
const LOGIN_PATH = __ENV.LOGIN_PATH || '/api/auth/login';
// Re-login once the cached token is this close to exp — absorbs clock skew
// and the in-flight request's own latency.
const TOKEN_REFRESH_SKEW_SEC = parseInt(__ENV.TOKEN_REFRESH_SKEW_SEC || '120', 10);
// Last-resort lifetime when neither the login response nor the JWT itself
// yields an exp (e.g. an opaque token). 50min < GoTrue's default 60min.
const TOKEN_TTL_FALLBACK_SEC = parseInt(__ENV.TOKEN_TTL_FALLBACK_SEC || '3000', 10);

const USE_REFRESH = RIDER_CREDENTIALS.length > 0;
// With credentials the pool is indexed by credential; RIDER_TOKENS[i] (when
// present) merely seeds rider i's first token. Without credentials the pool
// is the static token list, exactly as before.
const POOL_SIZE = USE_REFRESH ? RIDER_CREDENTIALS.length : RIDER_TOKENS.length;

const tokenRefreshes = new Counter('sched_token_refreshes');
const tokenRefreshFailures = new Counter('sched_token_refresh_failures');

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

// pick rotates deterministically through arr — no RNG. Math.random is banned
// here not for correctness but because CodeQL (js/insecure-randomness) flags
// any Math.random in a script that also handles credentials; (__VU, __ITER)
// gives the same uniform coverage across the run.
function pick(arr) {
  return arr[(__VU + __ITER) % arr.length];
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

// ── Token cache & refresh ─────────────────────────────────────────────────
// Per-VU token cache keyed by rider index — a plain object, not a Map, and
// deliberately no shared state: each VU is an isolate in k6.
const vuTokens = {}; // idx -> { token, expEpoch }
let lastRefreshWarnAt = 0;
let warnedStaticExpired = false;

// jwtExpEpoch decodes the JWT payload's `exp` claim. goja has no Buffer/atob —
// k6/encoding.b64decode is the supported path. We translate base64url → std
// base64 and pad ourselves so both padded and raw JWTs decode.
function jwtExpEpoch(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return 0;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const claims = JSON.parse(encoding.b64decode(b64, 'std', 's'));
    return typeof claims.exp === 'number' ? claims.exp : 0;
  } catch (e) {
    return 0; // opaque/non-JWT token — caller falls back to wall-clock TTL
  }
}

// loginFor mints a fresh token via LOGIN_PATH. Returns {token, expEpoch} or
// null on any failure. 429 is an EXPECTED status (loginLimiter under a
// single-IP load generator — same convention as integration/full_stack.js)
// so it doesn't inflate http_req_failed; every non-200 still counts in
// sched_token_refresh_failures.
function loginFor(cred) {
  const res = http.post(
    `${BASE_URL}${LOGIN_PATH}`,
    JSON.stringify({ email: cred.email, password: cred.password }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'login_refresh' },
      responseCallback: http.expectedStatuses(200, 429),
    }
  );
  let token = null;
  let expEpoch = 0;
  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      const session = body.session || body; // Go login wraps the GoTrue response in `session`
      token = session.access_token || null;
      if (token) {
        const now = Math.floor(Date.now() / 1000);
        expEpoch =
          session.expires_at ||
          (session.expires_in ? now + session.expires_in : 0) ||
          jwtExpEpoch(token) ||
          now + TOKEN_TTL_FALLBACK_SEC;
      }
    } catch (e) {
      token = null;
    }
  }
  if (!token) {
    tokenRefreshFailures.add(1);
    // Throttle the log line — under a persistent login outage this would
    // otherwise print once per refresh attempt per VU.
    const nowMs = Date.now();
    if (nowMs - lastRefreshWarnAt > 60000) {
      lastRefreshWarnAt = nowMs;
      console.warn(`token refresh via ${LOGIN_PATH} failed (status=${res.status}); will retry on next iteration`);
    }
    return null;
  }
  tokenRefreshes.add(1);
  return { token, expEpoch };
}

// ensureToken returns a usable token for rider idx. It refreshes proactively
// when the cached token is inside the expiry skew, and supports force=true for
// the reactive 401 path. Falls back to a stale token rather than none — the
// honest signal is a failed request, and the next iteration tries again.
function ensureToken(idx, force) {
  const now = Math.floor(Date.now() / 1000);
  let entry = vuTokens[idx];
  if (!entry) {
    const seed = USE_REFRESH ? RIDER_TOKENS[idx] || null : RIDER_TOKENS[idx];
    entry = {
      token: seed,
      expEpoch: seed ? jwtExpEpoch(seed) || now + TOKEN_TTL_FALLBACK_SEC : 0,
    };
    vuTokens[idx] = entry;
  }
  if (!force && entry.token && now < entry.expEpoch - TOKEN_REFRESH_SKEW_SEC) {
    return entry.token;
  }
  if (!USE_REFRESH) {
    // Static mode: nothing to refresh. Warn once per VU if the token is
    // actually expired/expiring so a 401 wall is diagnosable from the log.
    if (entry.token && entry.expEpoch > 0 && now >= entry.expEpoch - TOKEN_REFRESH_SKEW_SEC && !warnedStaticExpired) {
      warnedStaticExpired = true;
      console.warn(
        `rider token ${idx} is expired/expiring and RIDER_CREDENTIALS is not set — ` +
          'expect 401s for the rest of this run; provide RIDER_CREDENTIALS for mid-run refresh'
      );
    }
    return entry.token;
  }
  const fresh = loginFor(RIDER_CREDENTIALS[idx]);
  if (fresh) {
    entry.token = fresh.token;
    entry.expEpoch = fresh.expEpoch;
  }
  return entry.token;
}

export function setup() {
  if (POOL_SIZE === 0) {
    fail('No riders configured: set RIDER_TOKENS (static JWTs) or RIDER_CREDENTIALS (email:pass pairs)');
  }
  if (!USE_REFRESH) {
    console.warn(
      'RIDER_CREDENTIALS not set — using static RIDER_TOKENS. GoTrue access tokens ' +
        'expire ~1h after minting and CANNOT be refreshed without credentials; on runs ' +
        'longer than the token lifetime expect 401s. Set RIDER_CREDENTIALS=email:pass,... ' +
        'to enable mid-run token refresh.'
    );
  }
}

export default function () {
  // Fixed rider per VU (__VU is 1-based): stable identity gives each VU one
  // cached token to refresh instead of re-login churn across the whole pool.
  const idx = (__VU - 1) % POOL_SIZE;
  let token = ensureToken(idx, false);
  if (!token) {
    sleep(1);
    return;
  }
  const filter = pick(FILTERS);
  const limit = pick(LIMITS);
  const listURL = `${BASE_URL}/api/finance/mobility/scheduled?filter=${filter}&limit=${limit}`;

  // ── Page 1 ──────────────────────────────────────────────────────────────
  let page1Res = http.get(listURL, {
    headers: headersFor(token),
    tags: { name: 'GET /api/finance/mobility/scheduled' },
  });

  // Reactive refresh: a 401 means the cached exp was wrong (clock skew,
  // revoked session, opaque token) — force a re-login and retry ONCE. If the
  // login failed and returned the same stale token, don't retry: the check
  // below already records the failure and a second identical 401 would just
  // double-count it.
  if (page1Res.status === 401 && USE_REFRESH) {
    const fresh = ensureToken(idx, true);
    if (fresh && fresh !== token) {
      token = fresh;
      page1Res = http.get(listURL, {
        headers: headersFor(token),
        tags: { name: 'GET /api/finance/mobility/scheduled' },
      });
    }
  }

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

  sleep(0.3 + ((__VU * 7 + __ITER) % 10) / 10); // 0.3-1.2s deterministic think time between list reads
}
