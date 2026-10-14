import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSender } from '../senderCore.ts';
import { shouldEmit } from '../gate.ts';

const batch = [{ surface: 'mobile' as const, route: '/a/[id]', occurred_at: 't', extra: 'x' } as never];

function deps(over: Record<string, unknown> = {}) {
  const calls: { url: string; body: any; config: any }[] = [];
  return {
    calls,
    d: {
      getToken: async () => 'tok',
      baseURL: 'http://h',
      post: async (url: string, body: unknown, config: unknown) => {
        calls.push({ url, body, config });
        return { status: 200 };
      },
      ...over,
    },
  };
}

describe('sender safety contract', () => {
  test('401 response does not throw; validateStatus accepts it', async () => {
    const { d, calls } = deps({ post: async (u: string, b: unknown, c: any) => {
      assert.equal(c.validateStatus(401), true);
      return { status: 401 };
    } });
    await assert.doesNotReject(createSender(d as never)(batch));
    assert.equal(calls.length, 0);
  });
  test('network rejection is swallowed', async () => {
    const { d } = deps({ post: async () => { throw new Error('net'); } });
    await assert.doesNotReject(createSender(d as never)(batch));
  });
  test('token lookup failure is swallowed', async () => {
    const { d } = deps({ getToken: async () => { throw new Error('x'); } });
    await assert.doesNotReject(createSender(d as never)(batch));
  });
  test('no token -> no request', async () => {
    const { d, calls } = deps({ getToken: async () => null });
    await createSender(d as never)(batch);
    assert.equal(calls.length, 0);
  });
  test('body shape, path and bearer', async () => {
    const { d, calls } = deps();
    await createSender(d as never)(batch);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/api/v1/telemetry/navigation'));
    assert.deepEqual(calls[0].body, { events: [{ surface: 'mobile', route: '/a/[id]', occurred_at: 't' }] });
    assert.equal(calls[0].config.headers.Authorization, 'Bearer tok');
  });
  test('sender sources never import the shared api client', () => {
    for (const f of ['sender.ts', 'senderCore.ts']) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      assert.ok(!/from\s+['"]@\/api\/client['"]/.test(src), f);
    }
  });
});

describe('shouldEmit gate', () => {
  test('flag must be exactly "true"', () => {
    for (const f of [undefined, '', 'TRUE', '1', 'false', 'yes']) assert.equal(shouldEmit(f, { id: 'u' }), false);
    assert.equal(shouldEmit('true', { id: 'u' }), true);
  });
  test('logged out -> no-op', () => {
    assert.equal(shouldEmit('true', null), false);
    assert.equal(shouldEmit('true', undefined), false);
  });
});
