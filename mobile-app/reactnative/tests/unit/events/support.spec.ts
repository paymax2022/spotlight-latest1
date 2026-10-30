// Support desk helpers: deep-link kind parsing and the reply gate, which must
// match support_service.go Reply (only CLOSED refuses a reply).

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupportKind, canReplyToCase, SUPPORT_KINDS, SUPPORT_KIND_LABEL } from '@/features/events/support';

test('parseSupportKind accepts known kinds case-insensitively', () => {
  assert.equal(parseSupportKind('PAYMENT'), 'PAYMENT');
  assert.equal(parseSupportKind('refund'), 'REFUND');
});

test('parseSupportKind rejects unknown or missing kinds', () => {
  assert.equal(parseSupportKind(undefined), null);
  assert.equal(parseSupportKind(''), null);
  assert.equal(parseSupportKind('CHARGEBACK'), null);
});

test('canReplyToCase only refuses CLOSED', () => {
  assert.equal(canReplyToCase('OPEN'), true);
  assert.equal(canReplyToCase('IN_PROGRESS'), true);
  assert.equal(canReplyToCase('RESOLVED'), true);
  assert.equal(canReplyToCase('CLOSED'), false);
});

test('every kind has a label', () => {
  for (const k of SUPPORT_KINDS) assert.ok(SUPPORT_KIND_LABEL[k], k);
});
