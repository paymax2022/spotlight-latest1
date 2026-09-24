// Pure-logic unit test for errKind — run with Node's native TS type-stripping:
//   node --experimental-strip-types --test src/features/mobility/utils/__tests__/errKind.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errKind } from '../errKind.ts';

test('a real connectivity drop (no HTTP response) is classified offline', () => {
  assert.equal(errKind(new Error('Network Error')), 'offline');
  assert.equal(errKind({ message: 'timeout of 20000ms exceeded' }), 'offline');
  assert.equal(errKind(undefined), 'offline');
});

test('any answered backend error (404/5xx/validation) is classified genericError, not offline', () => {
  assert.equal(errKind({ response: { status: 404, data: { error: 'not found' } } }), 'genericError');
  assert.equal(errKind({ response: { status: 500, data: {} } }), 'genericError');
  assert.equal(errKind({ response: { status: 401 } }), 'genericError');
});
