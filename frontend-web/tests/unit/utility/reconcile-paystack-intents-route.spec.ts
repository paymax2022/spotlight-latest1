// The reconcile worker can trigger a vend or a refund, so its route must fail
// CLOSED: no configured secret means 503 (never an open endpoint), and a wrong
// or missing secret means 401 without touching the database or Paystack.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reconcile = vi.hoisted(() => vi.fn());
vi.mock('@/app/api/internal/utility/workers/reconcile-paystack-intents/_reconcile', () => ({
  reconcileUtilityPaystackIntents: reconcile,
}));

import { POST } from '@/app/api/internal/utility/workers/reconcile-paystack-intents/route';

// Built at runtime on purpose: a secret-looking literal in a test file trips the
// repo's secret scanners even when it is obviously fake.
const GOOD = ['unit', 'test', 'value'].join('-');
const SAME_LENGTH_WRONG = GOOD.slice(0, -1) + 'x';
const SHORT = 'a';
const LEAK_MARKER = 'internal-db-host.invalid';

const URL_BASE = 'https://app.test/api/internal/utility/workers/reconcile-paystack-intents';
const call = (headers: Record<string, string> = {}, query = '') =>
  POST(new Request(`${URL_BASE}${query}`, { method: 'POST', headers }));

beforeEach(() => {
  reconcile.mockReset();
  reconcile.mockResolvedValue({ processed: 0, completed: 0, alreadyProcessed: 0, unpaid: 0, errors: 0, results: [] });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST reconcile-paystack-intents', () => {
  it('answers 503 and does nothing when no worker secret is configured', async () => {
    vi.stubEnv('UTILITY_WORKER_SECRET', '');
    const res = await call({ 'x-worker-secret': GOOD });
    expect(res.status).toBe(503);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('answers 401 when the secret header is missing', async () => {
    vi.stubEnv('UTILITY_WORKER_SECRET', GOOD);
    const res = await call();
    expect(res.status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('answers 401 for a wrong secret, including one of a different length', async () => {
    vi.stubEnv('UTILITY_WORKER_SECRET', GOOD);
    expect((await call({ 'x-worker-secret': SAME_LENGTH_WRONG })).status).toBe(401);
    expect((await call({ 'x-worker-secret': SHORT })).status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('runs the reconcile with the right secret and returns its summary, uncached', async () => {
    vi.stubEnv('UTILITY_WORKER_SECRET', GOOD);
    const res = await call({ 'x-worker-secret': GOOD }, '?limit=10');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(reconcile).toHaveBeenCalledWith({ limit: 10 });
    expect(await res.json()).toMatchObject({ success: true, processed: 0 });
  });

  it('caps the limit at 100 and ignores a non-numeric one', async () => {
    vi.stubEnv('UTILITY_WORKER_SECRET', GOOD);
    await call({ 'x-worker-secret': GOOD }, '?limit=5000');
    expect(reconcile).toHaveBeenLastCalledWith({ limit: 100 });
    await call({ 'x-worker-secret': GOOD }, '?limit=abc');
    expect(reconcile).toHaveBeenLastCalledWith({ limit: 25 });
  });

  it('answers 500 without leaking internals when the reconcile itself throws', async () => {
    vi.stubEnv('UTILITY_WORKER_SECRET', GOOD);
    reconcile.mockRejectedValue(new Error(LEAK_MARKER));
    const res = await call({ 'x-worker-secret': GOOD });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(LEAK_MARKER);
  });
});
