// A 401 means two different things depending on where it happens, and getting
// that wrong is not a cosmetic bug: the sign-in screen told users "Your session
// has expired. Please sign in again." while they were signing in and had no
// session. These tests pin both readings.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AxiosError } from 'axios';
import { getErrorMessage, normalizeApiError } from '@/utils/errorMapper';

function axios401(body: unknown = { error: 'invalid credentials' }): AxiosError {
  const err = new AxiosError('Request failed with status code 401');
  // Minimal shape: the mapper only reads status and data.
  err.response = { status: 401, data: body, statusText: '', headers: {}, config: {} as never };
  return err;
}

test('401 on a sign-in attempt reads as rejected credentials', () => {
  const msg = getErrorMessage(axios401(), { authAttempt: true });
  assert.match(msg, /incorrect email\/phone number or password/i);
  assert.doesNotMatch(msg, /session/i, 'must not mention a session on the sign-in screen');
});

test('401 elsewhere still reads as an expired session', () => {
  const msg = getErrorMessage(axios401());
  assert.match(msg, /session has expired/i);
});

test('the option only affects 401', () => {
  const err = new AxiosError('boom');
  err.response = { status: 500, data: {}, statusText: '', headers: {}, config: {} as never };
  assert.equal(
    getErrorMessage(err, { authAttempt: true }),
    getErrorMessage(err),
    'a non-401 must map identically with and without authAttempt',
  );
});

test('a network failure is still reported as connectivity, not credentials', () => {
  const err = new AxiosError('Network Error');   // no response at all
  assert.match(getErrorMessage(err, { authAttempt: true }), /no internet connection/i);
});

test('normalizeApiError still exposes the status for callers that branch on it', () => {
  assert.equal(normalizeApiError(axios401()).status, 401);
});
