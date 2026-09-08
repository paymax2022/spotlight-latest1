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
