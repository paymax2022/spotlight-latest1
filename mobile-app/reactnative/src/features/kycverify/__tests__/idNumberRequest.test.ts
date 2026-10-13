// Pure-logic tests for the ID-number data-match request body.
// Run with `npm run test:kyc-verify` (node --test, strip-types).
// What these guard: the KYC form no longer collects the user's name/DOB — those
// are returned by the provider (Dojah) and persisted server-side — so the check
// request must carry ONLY the session + ID number, never a user-typed name/DOB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idNumberRequestBody } from '../idNumberRequest.ts';

test('body carries only session, id type and id number', () => {
  const body = idNumberRequestBody({ sessionId: 'vs_1', idType: 'NIN', idNumber: '70123456789' });
  assert.deepEqual(body, {
    session_id: 'vs_1',
    id_type: 'NIN',
    id_number: '70123456789',
  });
});

test('never sends first_name / last_name / dob (not collected from the user)', () => {
  const body = idNumberRequestBody({ sessionId: 'vs_1', idType: 'BVN', idNumber: '22222222222' }) as Record<
    string,
    unknown
  >;
  assert.equal('first_name' in body, false);
  assert.equal('last_name' in body, false);
  assert.equal('dob' in body, false);
});
