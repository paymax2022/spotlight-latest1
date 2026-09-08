// A form only stops asking for a detail when the account is judged to HAVE it.
// The judgement is this function, and its one interesting case is the fallback
// that makes `fullName` equal to the email: pre-filling "you@example.com" into a
// Full name field — and, on the forms that lock it, leaving no way to fix it —
// is worse than asking.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountName } from '@/features/account/name';

test('a real name is used as-is', () => {
  assert.equal(normalizeAccountName('Ada Okafor', 'ada@example.com'), 'Ada Okafor');
});

test('a name that is just the account email counts as no name', () => {
  assert.equal(normalizeAccountName('ada@example.com', 'ada@example.com'), '');
});

test('the email comparison ignores case and surrounding space', () => {
  assert.equal(normalizeAccountName('  Ada@Example.com ', 'ada@example.com'), '');
});

test('blank and missing names count as no name', () => {
  assert.equal(normalizeAccountName('   ', 'ada@example.com'), '');
  assert.equal(normalizeAccountName(undefined, 'ada@example.com'), '');
  assert.equal(normalizeAccountName(null, null), '');
});

test('a name is kept when the account has no email to compare against', () => {
  assert.equal(normalizeAccountName('Ada Okafor', undefined), 'Ada Okafor');
});
