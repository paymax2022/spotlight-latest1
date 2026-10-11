// The cron entry point must fail closed: it can vend and it can refund.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/server/utility/service', () => ({ runUtilityVendRetries: vi.fn() }));
import { runUtilityVendRetries } from '@/src/server/utility/service';
import { POST } from '@/app/api/internal/utility/workers/retry-failed-vends/route';

const url = 'http://localhost/api/internal/utility/workers/retry-failed-vends';
const call = (headers: Record<string, string> = {}, qs = '') =>
  POST(new Request(url + qs, { method: 'POST', headers }));

describe('POST /api/internal/utility/workers/retry-failed-vends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runUtilityVendRetries).mockResolvedValue({ scanned: 2, retried: 1, vended: 1, refunded: 1, held: 0, released: 0, manualReview: 0, skipped: 0, failed: 0 });
  });
  afterEach(() => { delete process.env.UTILITY_WORKER_SECRET; });

  it('is unavailable (503) when no worker secret is configured — never open', async () => {
    const res = await call({ 'x-worker-secret': 'anything' });
    expect(res.status).toBe(503);
    expect(runUtilityVendRetries).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong secret (401) without running the worker', async () => {
    process.env.UTILITY_WORKER_SECRET = 's3cret';
    expect((await call()).status).toBe(401);
    expect((await call({ 'x-worker-secret': 'wrong' })).status).toBe(401);
    expect(runUtilityVendRetries).not.toHaveBeenCalled();
  });

  it('runs with the right secret, returns the summary, and clamps the limit', async () => {
    process.env.UTILITY_WORKER_SECRET = 's3cret';
    const res = await call({ 'x-worker-secret': 's3cret' }, '?limit=9999');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, refunded: 1, vended: 1 });
    expect(runUtilityVendRetries).toHaveBeenCalledWith({ limit: 100 });
  });

  it('a worker crash is a clean 500, never a leaked stack', async () => {
    process.env.UTILITY_WORKER_SECRET = 's3cret';
    vi.mocked(runUtilityVendRetries).mockRejectedValue(new Error('db exploded: secret detail'));
    const res = await call({ 'x-worker-secret': 's3cret' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });
});
