// Pure-logic tests for the 401 classification and the return path.
//
// Run: node --experimental-strip-types --test "src/lib/__tests__/authError.test.ts"
//
// isUnauthorized decides whether a screen offers "Retry" or "Sign in". Getting it
// wrong in the lenient direction is the worse failure: a real outage would tell
// the user to sign in again, which does nothing and looks like the app rejecting
// a valid account.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Imported for their pure logic only. promptSignIn touches expo-router and is
// covered by the screen, not here.
import { isUnauthorized, currentPathForReturn } from '../authError.ts';

describe('isUnauthorized', () => {
  test('recognises an axios 401', () => {
    assert.equal(isUnauthorized({ response: { status: 401 } }), true);
  });

  test('recognises a bare status 401', () => {
    assert.equal(isUnauthorized({ status: 401 }), true);
  });

  test('403 is NOT a sign-in problem', () => {
    // Forbidden means signed in without permission. Sending that user to a login
    // form asks them to fix something logging in cannot fix.
    assert.equal(isUnauthorized({ response: { status: 403 } }), false);
  });

  test('server errors and timeouts stay retryable', () => {
    for (const status of [500, 502, 503, 504]) {
      assert.equal(isUnauthorized({ response: { status } }), false, `status ${status}`);
    }
    assert.equal(isUnauthorized(new Error('Network Error')), false);
  });

  test('survives the shapes an error can actually arrive in', () => {
    for (const v of [null, undefined, 'unauthorized', 401, {}, { response: {} }]) {
      assert.equal(isUnauthorized(v), false, `value ${String(v)}`);
    }
  });
});

describe('currentPathForReturn', () => {
  const withLocation = (loc: unknown, fn: () => void) => {
    const g = globalThis as unknown as { window?: unknown };
    const had = 'window' in g;
    const prev = g.window;
    g.window = loc === undefined ? undefined : { location: loc };
    try { fn(); } finally { if (had) g.window = prev; else delete g.window; }
  };

  test('returns the current path with its query', () => {
    withLocation({ pathname: '/properties', search: '?filter=vacant' }, () => {
      assert.equal(currentPathForReturn(), '/properties?filter=vacant');
    });
  });

  test('never returns a login screen — that would loop', () => {
    withLocation({ pathname: '/(auth)/login', search: '' }, () => {
      assert.equal(currentPathForReturn(), undefined);
    });
    withLocation({ pathname: '/admin/login', search: '' }, () => {
      assert.equal(currentPathForReturn(), undefined);
    });
  });

  test('refuses anything that is not a rooted path (open-redirect guard)', () => {
    // The login screen validates this too, but a caller should not be handing it
    // an absolute URL in the first place.
    for (const pathname of ['https://evil.example/x', '//evil.example', 'properties', '']) {
      withLocation({ pathname, search: '' }, () => {
        assert.equal(currentPathForReturn(), undefined, `pathname ${pathname}`);
      });
    }
  });

  test('is undefined off-web, where there is no address bar to read', () => {
    withLocation(undefined, () => {
      assert.equal(currentPathForReturn(), undefined);
    });
  });
});

// The throttle lives in authRedirect.ts, which imports expo-router and so cannot
// be loaded here. Its CONTRACT is asserted instead: a burst of failures inside
// the window must collapse to one action, and the window must reopen afterwards
// so a later expiry can still prompt.
describe('sign-in prompt throttle (contract)', () => {
  const COOLDOWN_MS = 3_000;
  const makeThrottled = (now: () => number) => {
    // -Infinity, matching the implementation: the FIRST prompt must never be
    // throttled regardless of what the clock reads. Initialising to 0 swallowed
    // it whenever the clock started near zero — which is exactly what the test
    // below caught.
    let last = Number.NEGATIVE_INFINITY;
    return () => {
      const t = now();
      if (t - last < COOLDOWN_MS) return false;
      last = t;
      return true;
    };
  };

  test('a burst of parallel 401s causes exactly one navigation', () => {
    let clock = 10_000;
    const fire = makeThrottled(() => clock);
    // Six queries failing within a few ms of each other — a normal screen load.
    const results = [0, 1, 2, 5, 9, 14].map((tick) => { clock = 10_000 + tick; return fire(); });
    assert.deepEqual(results, [true, false, false, false, false, false]);
  });

  test('the window reopens, so a later expiry still prompts', () => {
    let clock = 0;
    const fire = makeThrottled(() => clock);
    assert.equal(fire(), true);
    clock = COOLDOWN_MS - 1;
    assert.equal(fire(), false, 'still inside the window');
    clock = COOLDOWN_MS + 1;
    // A permanent flag here would leave the user stuck on a dead screen with no
    // way to reach the login form for the rest of the session.
    assert.equal(fire(), true, 'window must reopen');
  });
});
