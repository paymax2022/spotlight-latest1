// Pure-logic tests for the shared checkout PIN gate.
//   node --experimental-strip-types --test src/features/payments/__tests__/paymentFlow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePinRequiredFlag,
  requiresPin,
  isValidPin,
} from '../paymentFlow.ts';

test('parsePinRequiredFlag defaults ON (secure by default)', () => {
  assert.equal(parsePinRequiredFlag(undefined), true);
  assert.equal(parsePinRequiredFlag(''), true);
  assert.equal(parsePinRequiredFlag('true'), true);
  assert.equal(parsePinRequiredFlag('anything'), true);
});

test('parsePinRequiredFlag only the literal "false" disables it (kill-switch)', () => {
  assert.equal(parsePinRequiredFlag('false'), false);
});

test('requiresPin gates the wallet rail only, never card', () => {
  assert.equal(requiresPin('wallet', true), true);
  assert.equal(requiresPin('wallet', false), false); // kill-switch off
  assert.equal(requiresPin('card', true), false);    // card → gateway auth
  assert.equal(requiresPin('card', false), false);
});

test('isValidPin accepts exactly 4 digits', () => {
  assert.equal(isValidPin('1234'), true);
  assert.equal(isValidPin('0000'), true);
  assert.equal(isValidPin('123'), false);
  assert.equal(isValidPin('12345'), false);
  assert.equal(isValidPin('12a4'), false);
  assert.equal(isValidPin(''), false);
});
