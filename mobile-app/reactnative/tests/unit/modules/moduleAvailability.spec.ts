// Pure-logic unit tests for "this module is not available here".
// Run: npm run test:modules
//
// A feature flag gates ROUTE REGISTRATION server-side, so a disabled module 404s
// every path under it. React Query's defaults then turn one absent module into a
// request on every window focus — which is how a cached /property/context query
// came to 404 repeatedly on a visitor-code page that has nothing to do with
// property.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isModuleAbsent, moduleQueryOptions } from '@/lib/moduleAvailability';

const httpError = (status: number) => ({ response: { status } });

describe('isModuleAbsent', () => {
  it('treats 404 as absence', () => {
    assert.equal(isModuleAbsent(httpError(404)), true);
  });

  it('does NOT treat a server error or timeout as absence', () => {
    // These are transient and must keep their retry — calling them "absent"
    // would make a blip look like a switched-off module.
    for (const s of [500, 502, 503, 429, 408]) {
      assert.equal(isModuleAbsent(httpError(s)), false, `status ${s}`);
    }
    assert.equal(isModuleAbsent(new Error('Network Error')), false);
    assert.equal(isModuleAbsent(undefined), false);
    assert.equal(isModuleAbsent(null), false);
  });

  it('leaves 401 alone — the API client interceptor owns that', () => {
    assert.equal(isModuleAbsent(httpError(401)), false);
  });

  it('ignores a non-numeric status rather than guessing', () => {
    assert.equal(isModuleAbsent({ response: { status: '404' } }), false);
  });
});

describe('moduleQueryOptions', () => {
  const opts = moduleQueryOptions();

  it('never retries an absent module', () => {
    assert.equal(opts.retry(0, httpError(404)), false);
    assert.equal(opts.retry(5, httpError(404)), false);
  });

  it('still retries a real failure, up to the limit', () => {
    assert.equal(opts.retry(0, httpError(500)), true);
    assert.equal(opts.retry(1, httpError(500)), true);
    assert.equal(opts.retry(2, httpError(500)), false, 'stops at the limit');
  });

  it('stops refetching on window focus once the module is known absent', () => {
    // The specific noise this fixes: the query re-firing on every focus event
    // from an unrelated screen.
    assert.equal(opts.refetchOnWindowFocus({ state: { error: httpError(404) } }), false);
  });

  it('still refetches on focus after a transient failure or a success', () => {
    assert.equal(opts.refetchOnWindowFocus({ state: { error: httpError(503) } }), true);
    assert.equal(opts.refetchOnWindowFocus({ state: { error: null } }), true);
  });

  it('honours a custom retry budget', () => {
    const strict = moduleQueryOptions(0);
    assert.equal(strict.retry(0, httpError(500)), false);
  });
});
