// Pure-logic unit test — run with Node's native TS type-stripping:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/cardInitError.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardInitFailure, CARD_UNAVAILABLE_MESSAGE } from '../cardInitError.ts';

test('a server 500 becomes a plain sentence, not the word "internal"', () => {
  const err = Object.assign(new Error('internal'), { response: { status: 500, data: { error: 'internal' } } });
  const out = cardInitFailure(err);
  assert.ok(out instanceof Error);
  assert.equal((out as Error).message, CARD_UNAVAILABLE_MESSAGE);
});

test('the bare word "internal" is rewritten even without an HTTP response', () => {
  assert.equal((cardInitFailure(new Error('internal')) as Error).message, CARD_UNAVAILABLE_MESSAGE);
});

test('email_required is passed through untouched so the email prompt still works', () => {
  const err = { response: { status: 422, data: { error: 'email_required' } } };
  assert.equal(cardInitFailure(err), err);
});

test('a specific client error keeps its own message', () => {
  const err = Object.assign(new Error('Paystack-funded rides must use instant pricing'), {
    response: { status: 400, data: { error: 'invalid_input' } },
  });
  assert.equal((cardInitFailure(err) as Error).message, 'Paystack-funded rides must use instant pricing');
});

test('anything that is not an Error falls back to the plain sentence', () => {
  assert.equal((cardInitFailure(undefined) as Error).message, CARD_UNAVAILABLE_MESSAGE);
  assert.equal((cardInitFailure('boom') as Error).message, CARD_UNAVAILABLE_MESSAGE);
});
