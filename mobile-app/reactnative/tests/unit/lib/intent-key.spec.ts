// A money mutation retried after a timeout must replay the SAME idempotency
// key, or the server sees a second, unrelated debit. withIntentKey holds the key
// for an intent only while its outcome is unknown.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withIntentKey, clearIntentKeys } from '@/utils/intentKey';

const intent = { recipientIdentifier: '08030000000', amountKobo: 5_000_000 };

async function attempt(outcome: 'ok' | { status?: number }, payload: unknown = intent): Promise<string> {
  let seen = '';
  try {
    await withIntentKey('transfer:paymax', payload, async (key) => {
      seen = key;
      if (outcome !== 'ok') throw Object.assign(new Error('failed'), outcome.status ? { response: { status: outcome.status } } : {});
      return true;
    });
  } catch { /* the key is what is under test */ }
  return seen;
}

test('a timeout (no response) keeps the key for the retry', async () => {
  clearIntentKeys();
  const first = await attempt({});
  assert.equal(await attempt('ok'), first);
});

test('a 5xx keeps the key for the retry', async () => {
  clearIntentKeys();
  const first = await attempt({ status: 502 });
  assert.equal(await attempt('ok'), first);
});

test('success releases the key so a deliberate repeat is a new transfer', async () => {
  clearIntentKeys();
  const first = await attempt('ok');
  assert.notEqual(await attempt('ok'), first);
});

test('a definitive 4xx releases the key', async () => {
  clearIntentKeys();
  const first = await attempt({ status: 403 });
  assert.notEqual(await attempt('ok'), first);
});

test('a different amount is a different intent', async () => {
  clearIntentKeys();
  const first = await attempt({});
  assert.notEqual(await attempt({}, { ...intent, amountKobo: 1 }), first);
});

test('key order in the intent does not matter', async () => {
  clearIntentKeys();
  const first = await attempt({});
  assert.equal(await attempt({}, { amountKobo: intent.amountKobo, recipientIdentifier: intent.recipientIdentifier }), first);
});
