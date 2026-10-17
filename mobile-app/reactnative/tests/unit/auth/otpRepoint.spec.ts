// The mobile client no longer calls supabase.auth for verification or reset.
// It could not keep doing so: once server-issued OTP is on, registration creates
// the account through GoTrue's ADMIN endpoint, which sends nothing, so GoTrue
// never mints a code for supabase.auth.verifyOtp to check. Every newly
// registered user would have failed verification.
// auth.api.ts itself cannot be imported here — it pulls in the Supabase client
// and React Native polyfills — so the parts worth pinning were split into
// src/api/authOtp.ts and are exercised directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OTP_ROUTES,
  accountNotFoundMessage,
  forgotPasswordBody,
  getPendingReset,
  setPendingReset,
  clearPendingReset,
  verifyResetCodeBody,
  isMfaChallenge,
  loginStepUpBody,
  readSession,
  resendBody,
  resetWithTokenBody,
  verificationSignedIn,
  verifyEmailBody,
} from '@/api/authOtp';

test('every OTP call targets the backend, never supabase.auth', () => {
  // Each of these used to be a direct supabase.auth call.
  assert.equal(OTP_ROUTES.verifyEmail, '/api/auth/verify-otp');
  assert.equal(OTP_ROUTES.resend, '/api/auth/resend-otp');
  assert.equal(OTP_ROUTES.forgotPassword, '/api/auth/forgot-password');
  assert.equal(OTP_ROUTES.verifyResetCode, '/api/auth/verify-password-reset-otp');
  assert.equal(OTP_ROUTES.resetPassword, '/api/auth/reset-password');
  // The sign-in step-up is a SEPARATE route from sign-up verification: that one
  // returns a session, this one deliberately does not, so keeping them apart
  // means a caller cannot obtain a session from the sign-up route.
  assert.equal(OTP_ROUTES.loginStepUp, '/api/auth/otp-verify');
  assert.notEqual(OTP_ROUTES.loginStepUp, OTP_ROUTES.verifyEmail);
});

test('addresses are normalised, and codes trimmed, before they are sent', () => {
  // The server keys a code on the LOWERCASED address. Sending mixed case would
  // look up nothing and report an invalid code for a correct one.
  assert.deepEqual(verifyEmailBody('  Ada@Example.TEST ', ' 482913 '),
    { email: 'ada@example.test', otp: '482913' });
  assert.deepEqual(resendBody(' A@B.test '), { email: 'a@b.test' });
  assert.deepEqual(forgotPasswordBody(' A@B.test '), { identifier: 'a@b.test' });
  // A phone number is only trimmed — the server owns its normalisation.
  assert.deepEqual(forgotPasswordBody(' 0803 000 0000 '), { identifier: '0803 000 0000' });
  assert.deepEqual(loginStepUpBody(' A@B.test ', ' 654321 '), { email: 'a@b.test', code: '654321' });
  assert.deepEqual(verifyResetCodeBody(' A@B.test ', ' 482913 '), { identifier: 'a@b.test', code: '482913' });
  assert.deepEqual(resetWithTokenBody(' A@B.test ', 'tok', 'pw'),
    { identifier: 'a@b.test', resetToken: 'tok', password: 'pw' });
});

test('the reset token lives in memory and can be cleared', () => {
  clearPendingReset();
  assert.equal(getPendingReset(), null);
  setPendingReset(' A@B.test ', 'tok');
  assert.deepEqual(getPendingReset(), { identifier: 'a@b.test', resetToken: 'tok' });
  clearPendingReset();
  assert.equal(getPendingReset(), null);
});

test('verification reports a session ONLY when one really came back', () => {
  // Supabase's signup OTP signs the user in.
  assert.equal(verificationSignedIn({ signedIn: true, tokens: { accessToken: 'a', refreshToken: 'r' } }), true);

  // The server-issued path confirms the account and stops — control of a mailbox
  // sends the user to a logged-in screen with no session.
  assert.equal(verificationSignedIn({ signedIn: false, tokens: { accessToken: '', refreshToken: '' } }), false);

  // And a response that CLAIMS a session without tokens is not one.
  assert.equal(verificationSignedIn({ signedIn: true }), false);
  assert.equal(verificationSignedIn({ signedIn: true, tokens: { accessToken: 'a' } }), false);
  assert.equal(verificationSignedIn({}), false);
});

test('a login response is read as a challenge, not as a failure', () => {
  // A CORRECT password answered with mfaRequired must not be mistaken for a
  // failed sign-in, which would strand the user with a code and nowhere to use it.
  assert.equal(isMfaChallenge({ mfaRequired: true }), true);
  assert.equal(isMfaChallenge({}), false);
  assert.equal(isMfaChallenge({ mfaRequired: false }), false);
  // Only a real boolean counts; a truthy string must not enable it.
  assert.equal(isMfaChallenge({ mfaRequired: 'true' } as never), false);
});

test('a token pair is only accepted when both halves are present', () => {
  assert.deepEqual(readSession({ access_token: 'a', refresh_token: 'r' }),
    { accessToken: 'a', refreshToken: 'r' });
  // no way to refresh.
  assert.equal(readSession({ access_token: 'a' }), null);
  assert.equal(readSession({ refresh_token: 'r' }), null);
  assert.equal(readSession(undefined), null);
  assert.equal(readSession({ access_token: 123 as never, refresh_token: 'r' }), null);
});

// The reset request answers 404 account_not_found when nothing matches, and the
// screen must say so using what the user typed rather than a generic failure.
test('accountNotFoundMessage names the address the user typed', () => {
  const err = { response: { status: 404, data: { error: 'account_not_found' } } };
  assert.equal(accountNotFoundMessage(err, '  Ada@Example.com '), 'No account found for ada@example.com.');
});

test('accountNotFoundMessage handles a phone number as typed', () => {
  const err = { response: { status: 404, data: { error: 'account_not_found' } } };
  assert.equal(accountNotFoundMessage(err, '0803 000 0000'), 'No account found for 0803 000 0000.');
});

test('accountNotFoundMessage ignores every other failure', () => {
  assert.equal(accountNotFoundMessage({ response: { status: 429, data: { error: 'Too many attempts.' } } }, 'a@b.co'), null);
  assert.equal(accountNotFoundMessage({ response: { status: 404, data: { error: 'Not found' } } }, 'a@b.co'), null);
  assert.equal(accountNotFoundMessage(new Error('Network Error'), 'a@b.co'), null);
  assert.equal(accountNotFoundMessage(undefined, 'a@b.co'), null);
});
