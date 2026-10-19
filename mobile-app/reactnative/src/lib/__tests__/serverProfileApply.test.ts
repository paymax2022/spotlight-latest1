// Store-side logic that is testable without React Native: where supabase-js
// keeps the session, and the apply ordering (validate -> clear -> persist ->
// reload, stopping when the old session cannot be cleared).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { supabaseAuthStorageKey, runApplySteps, settleWithin } from '../serverProfile.ts';

describe('supabaseAuthStorageKey', () => {
  test('uses the first hostname label', () => {
    assert.equal(supabaseAuthStorageKey('http://localhost:54321'), 'sb-localhost-auth-token');
    assert.equal(supabaseAuthStorageKey('http://192.168.1.5:54321'), 'sb-192-auth-token');
    assert.equal(supabaseAuthStorageKey('http://10.0.2.2:54321'), 'sb-10-auth-token');
    assert.equal(supabaseAuthStorageKey('https://wnicsubiznmishkmunsv.supabase.co'), 'sb-wnicsubiznmishkmunsv-auth-token');
  });
  test('null when there is no usable hostname', () => {
    for (const u of ['', 'not a url', 'http://', 'http://[::1]:54321']) {
      assert.equal(supabaseAuthStorageKey(u), null, u);
    }
  });
});

describe('runApplySteps ordering', () => {
  function recorder(failAt?: 'clear' | 'persist' | 'reload') {
    const calls: string[] = [];
    const step = (name: 'clear' | 'persist' | 'reload') => async () => {
      calls.push(name);
      if (failAt === name) throw new Error(`${name} failed`);
    };
    return { calls, steps: { clear: step('clear'), persist: step('persist'), reload: step('reload') } };
  }

  test('runs clear, persist, reload in order', async () => {
    const { calls, steps } = recorder();
    assert.deepEqual(await runApplySteps(steps), { ok: true });
    assert.deepEqual(calls, ['clear', 'persist', 'reload']);
  });
  test('a clear failure stops persist and reload and is reported', async () => {
    const { calls, steps } = recorder('clear');
    const r = await runApplySteps(steps);
    assert.deepEqual(calls, ['clear']);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /sign out.*clear failed/);
  });
  test('a persist failure stops reload and is reported', async () => {
    const { calls, steps } = recorder('persist');
    const r = await runApplySteps(steps);
    assert.deepEqual(calls, ['clear', 'persist']);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /save/);
  });
  test('a reload failure tells the user to reopen the app', async () => {
    const { steps } = recorder('reload');
    const r = await runApplySteps(steps);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Close and reopen/);
  });
});

describe('settleWithin', () => {
  test('returns the value when the promise wins', async () => {
    assert.equal(await settleWithin(Promise.resolve('x'), 1000, 'timeout'), 'x');
  });
  test('returns the fallback when the promise hangs', async () => {
    assert.equal(await settleWithin(new Promise<string>(() => {}), 20, 'timeout'), 'timeout');
  });
  test('propagates a rejection', async () => {
    await assert.rejects(settleWithin(Promise.reject(new Error('boom')), 1000, 'timeout'), /boom/);
  });
});
