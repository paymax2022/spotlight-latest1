import test from 'node:test';
import assert from 'node:assert/strict';

import { isBillableEmail, isEmailRequiredError, EMAIL_REQUIRED_CODE } from '../billingEmail.ts';
import { promptEmailAsync, resolveEmailPrompt, subscribeEmailPrompt } from '../../../lib/emailPrompt.ts';

// Mirrors backend/internal/platform/billingemail and frontend-web's isBillableEmail.
test('isBillableEmail accepts routable addresses', () => {
  for (const e of ['a@b.com', 'first.last+tag@sub.example.org', 'x@y.ng', 'A@B.COM', '  me@gmail.com ']) {
    assert.equal(isBillableEmail(e), true, e);
  }
});

test('isBillableEmail rejects malformed and non-routable addresses', () => {
  for (const e of [
    '', '   ', 'plain', 'a@b', 'a@@b.com', 'a b@c.com', 'a@.com', 'a@b..com', '@b.com', 'a@b.',
    'u@spotlight.internal', 'u@x.local', 'u@x.localhost', 'u@x.test', 'u@x.invalid', 'u@x.example', 'U@X.INTERNAL',
  ]) {
    assert.equal(isBillableEmail(e), false, e);
  }
});

test('isEmailRequiredError recognises the backend 422 in axios and flattened shapes', () => {
  assert.equal(EMAIL_REQUIRED_CODE, 'email_required');
  assert.equal(isEmailRequiredError({ response: { status: 422, data: { error: 'email_required' } } }), true);
  assert.equal(isEmailRequiredError({ status: 422, data: { error: 'email_required' } }), true);
  assert.equal(isEmailRequiredError({ code: 'email_required' }), true);
});

test('isEmailRequiredError ignores everything else', () => {
  assert.equal(isEmailRequiredError(null), false);
  assert.equal(isEmailRequiredError(new Error('email_required')), false);
  assert.equal(isEmailRequiredError({ response: { status: 422, data: { error: 'PROHIBITED_ACK_REQUIRED' } } }), false);
  assert.equal(isEmailRequiredError({ response: { status: 500, data: { error: 'email_required' } } }), false);
});

test('promptEmailAsync resolves with the entered address, null on cancel', async () => {
  let queue: { id: number }[] = [];
  const unsub = subscribeEmailPrompt((q) => { queue = q; });

  const a = promptEmailAsync({ title: 't' });
  assert.equal(queue.length, 1);
  resolveEmailPrompt(queue[0].id, 'me@gmail.com');
  assert.equal(await a, 'me@gmail.com');
  assert.equal(queue.length, 0);

  const b = promptEmailAsync({ title: 't' });
  resolveEmailPrompt(queue[0].id, null);
  assert.equal(await b, null);
  unsub();
});

test('promptEmailAsync without a mounted host resolves null instead of hanging', async () => {
  assert.equal(await promptEmailAsync({ title: 't' }), null);
});
