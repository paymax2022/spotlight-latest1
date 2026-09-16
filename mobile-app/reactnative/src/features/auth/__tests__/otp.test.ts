import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOtpLength, distributeOtpInput, nextOtpFocus, OTP_DEFAULT,
} from '../otp.ts';

test('resolveOtpLength: production 8 is honoured, not clamped to 6', () => {
  // The whole point: prod issues 8-digit codes.
  assert.equal(resolveOtpLength('8'), 8);
  assert.equal(resolveOtpLength(8), 8);
});

test('resolveOtpLength: defaults when unset or nonsense', () => {
  for (const bad of [undefined, null, '', 'abc', NaN, 6.5, 0, -3, 99]) {
    assert.equal(resolveOtpLength(bad as never), OTP_DEFAULT, `bad input: ${String(bad)}`);
  }
});

test('distributeOtpInput: a pasted full code fills every box', () => {
  // The old handler did text.slice(-1) and kept only "6".
  const out = distributeOtpInput(Array(6).fill(''), 0, '123456');
  assert.deepEqual(out, ['1', '2', '3', '4', '5', '6']);
});

test('distributeOtpInput: an 8-digit paste fills 8 boxes', () => {
  const out = distributeOtpInput(Array(8).fill(''), 0, '12345678');
  assert.equal(out.join(''), '12345678');
});

test('distributeOtpInput: strips the prose autofill wraps around a code', () => {
  const out = distributeOtpInput(Array(6).fill(''), 0, 'Your code is 481920');
  assert.deepEqual(out, ['4', '8', '1', '9', '2', '0']);
});

test('distributeOtpInput: never overflows the box count', () => {
  const out = distributeOtpInput(Array(6).fill(''), 0, '12345678901234');
  assert.equal(out.length, 6);
  assert.equal(out.join(''), '123456');
});

test('distributeOtpInput: single character still lands in its own box', () => {
  const out = distributeOtpInput(['1', '', ''], 1, '7');
  assert.deepEqual(out, ['1', '7', '']);
});

test('distributeOtpInput: a paste mid-way starts at that box', () => {
  const out = distributeOtpInput(['9', '', '', ''], 1, '123');
  assert.deepEqual(out, ['9', '1', '2', '3']);
});

test('nextOtpFocus: lands on the first gap, else the last box', () => {
  assert.equal(nextOtpFocus(['1', '2', '', ''], 0), 2);
  assert.equal(nextOtpFocus(['1', '2', '3'], 0), 2);   // complete -> last
});
