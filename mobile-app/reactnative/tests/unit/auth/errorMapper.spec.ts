// A 401 means two different things depending on where it happens, and getting
// that wrong is not a cosmetic bug: the sign-in screen told users "Your session
// has expired. Please sign in again." while they were signing in and had no
// session. These tests pin both readings.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AxiosError } from 'axios';
import { getErrorMessage, LOGIN_CAUSE_CODES, normalizeApiError } from '@/utils/errorMapper';

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

// WHY THE COPY MUST NAME THE EXIT. A sign-up whose email was already taken gets a
// DECOY success (auth_service.go returns AlreadyExisted so signup cannot enumerate
// accounts), so no account is created with the password just typed — and the very
// next login is this 401. "Please try again" sends that person back to the same
// dead end. The reset link is the way out, and pointing at it says exactly the
// same thing for an unknown address as for a known one, so no existence leaks.
test('the sign-in 401 names the way out', () => {
  const msg = getErrorMessage(axios401(), { authAttempt: true });
  assert.match(msg, /forgot password/i, 'a rejected sign-in must point at the reset path');
});

// ADR-PR802: Go now names WHY a sign-in was refused, in the response body. The
// mapper's job stops being to invent that sentence. Each cause must reach the
// screen in the server's own words — this is the whole point of the change, and
// the locked/suspended/unregistered cases are exactly what the generic copy used
// to flatten into "wrong password".
const NAMED_CAUSES: Array<[number, string, string]> = [
  [401, 'account_not_found', 'No account found for 08035550111. Check you typed it correctly, or create an account.'],
  [401, 'incorrect_password', 'Incorrect password for 08035550111. 3 attempts left before the account locks.'],
  [423, 'account_locked', 'Account locked for 08035550111 after too many failed sign-in attempts. Try again in 12 minutes.'],
  [423, 'account_locked_by_support', 'Your account is locked by our team. Contact support to have it reviewed.'],
  [403, 'account_suspended', 'This account is suspended. Contact support to have it reviewed.'],
  [403, 'account_closed', 'This account was closed. You can create a new one with the same email address.'],
  [400, 'invalid_identifier', 'Enter a valid email address or phone number.'],
  [400, 'ambiguous_identifier', 'That phone number is linked to more than one account. Sign in with your email address instead.'],
  [500, 'account_record_missing', "We can't load your account right now. Try again, or contact support."],
];

for (const [status, code, message] of NAMED_CAUSES) {
  test(`a ${status} ${code} renders the server's sentence, unmapped`, () => {
    const err = new AxiosError(`Request failed with status code ${status}`);
    err.response = { status, data: { error: message, code }, statusText: '', headers: {}, config: {} as never };
    // authAttempt:true is what the sign-in screen passes; it may only rewrite an
    // UNNAMED 401.
    assert.equal(getErrorMessage(err, { authAttempt: true }), message);
  });
}

// The list is written out here rather than read from the export: iterating the
// export would make deleting an entry delete its test (proven — dropping
// 'account_locked' from LOGIN_CAUSE_CODES left the suite green at 65 passing).
// Pinned separately, a removed cause is a red in two places.
const EXPECTED_LOGIN_CAUSE_CODES = [
  'invalid_identifier',
  'ambiguous_identifier',
  'account_not_found',
  'incorrect_password',
  'account_locked',
  'account_locked_by_support',
  'account_suspended',
  'account_closed',
  'account_record_missing',
];

test('LOGIN_CAUSE_CODES holds exactly the causes Go is allowed to name', () => {
  assert.deepEqual([...LOGIN_CAUSE_CODES].sort(), [...EXPECTED_LOGIN_CAUSE_CODES].sort());
});

// LOGIN_CAUSE_CODES is the only thing standing between a named cause and the
// generic credentials copy, and the generic copy may only replace a 401. Proving
// membership for every entry, at every status the server could send it with, is
// what makes dropping one from the list a red instead of a silent regression.
for (const code of EXPECTED_LOGIN_CAUSE_CODES) {
  for (const status of [400, 401, 403, 423, 500]) {
    test(`a ${status} carrying ${code} keeps the server's sentence`, () => {
      const sentence = `server sentence for ${code}`;
      const err = new AxiosError(`Request failed with status code ${status}`);
      err.response = { status, data: { error: sentence, code }, statusText: '', headers: {}, config: {} as never };
      assert.equal(getErrorMessage(err, { authAttempt: true }), sentence);
      assert.equal(normalizeApiError(err).message, sentence);
    });
  }
}

test('a named login cause never reads as a session expiry', () => {
  const err = new AxiosError('Request failed with status code 401');
  err.response = {
    status: 401,
    data: { error: 'No account found for 08035550111.', code: 'account_not_found' },
    statusText: '',
    headers: {},
    config: {} as never,
  };
  assert.doesNotMatch(getErrorMessage(err, { authAttempt: true }), /session has expired/i);
});

test('401 elsewhere still reads as an expired session', () => {
  const msg = getErrorMessage(axios401());
  assert.match(msg, /session has expired/i);
});

// The 401 branch gained an exemption for the named login causes, so this pins the
// other side of it: a code that is NOT a login cause must not get a richer reading
// on a 401. A lapsed session that happens to carry INSUFFICIENT_BALANCE in its body
// is still a session problem — tests/unit/social/requestActions.spec.ts makes the
// same rule for a money screen, and the mapper may not contradict it.
test('a 401 carrying a non-login code still reads as an expired session', () => {
  const err = new AxiosError('Request failed with status code 401');
  err.response = {
    status: 401,
    data: { error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' },
    statusText: '',
    headers: {},
    config: {} as never,
  };
  assert.match(getErrorMessage(err), /session has expired/i);
  assert.equal(normalizeApiError(err).code, 'UNAUTHORIZED');
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
