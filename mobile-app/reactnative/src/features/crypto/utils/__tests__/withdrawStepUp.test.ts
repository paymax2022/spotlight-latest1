// The withdrawal PIN is handed from the PIN screen to the submit step in memory,
// once — never through route params (on Expo web those land in the URL and
// browser history).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setWithdrawalPin, takeWithdrawalPin, isPinRefusal } from '../withdrawStepUp.ts';

test('the PIN is consumed exactly once', () => {
  setWithdrawalPin('4821');
  assert.equal(takeWithdrawalPin(), '4821');
  assert.equal(takeWithdrawalPin(), null, 'a second read (e.g. a re-render or reload) gets nothing');
});

test('an empty PIN is never stored', () => {
  setWithdrawalPin('');
  assert.equal(takeWithdrawalPin(), null);
});

test('PIN refusals from the server are recognised so the user can re-enter it', () => {
  for (const code of ['pin_invalid', 'pin_required']) {
    assert.equal(isPinRefusal({ response: { status: code === 'pin_required' ? 400 : 403, data: { code } } }), true, code);
  }
  assert.equal(isPinRefusal({ response: { status: 403, data: { code: 'pin_not_set' } } }), false, 'no PIN yet is a different fix');
  assert.equal(isPinRefusal({ response: { status: 403, data: { error: 'tier limit' } } }), false);
  assert.equal(isPinRefusal(new Error('Network Error')), false);
});
