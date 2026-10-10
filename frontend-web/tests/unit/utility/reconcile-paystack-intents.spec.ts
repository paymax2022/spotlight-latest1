// A Paystack-funded utility purchase only vends when something VERIFIES the
// payment: the charge.success webhook, the browser callback, or the app's own
// poll. If none of them lands (webhook not delivered, customer closes the app),
// the intent stays `pending` forever: money taken, nothing vended, nothing
// refunded. The reconcile worker finds those intents and runs them through the
// SAME idempotent verify path, so a late success vends once and an unpaid
// checkout is left alone.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabase = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, calls: [] as Array<[string, ...unknown[]]>, error: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'lt', 'gt', 'order', 'limit']) {
      builder[m] = (...args: unknown[]) => {
        supabase.calls.push([m, ...args]);
        return builder;
      };
    }
    builder.from = (...args: unknown[]) => {
      supabase.calls.push(['from', ...args]);
      return builder;
    };
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: supabase.rows, error: supabase.error });
    return builder;
  },
}));

const verifyPaystackPayment = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/voting/payment/paystack', () => ({ verifyPaystackPayment }));

const verifyUtilityPaystackPayment = vi.hoisted(() => vi.fn());
vi.mock('@/app/api/v1/utility/paystack/_service', () => ({ verifyUtilityPaystackPayment }));

import { reconcileUtilityPaystackIntents } from '@/app/api/internal/utility/workers/reconcile-paystack-intents/_reconcile';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const intent = (reference: string) => ({ id: `id-${reference}`, payment_reference: reference });

beforeEach(() => {
  supabase.rows = [];
  supabase.calls = [];
  supabase.error = null;
  verifyPaystackPayment.mockReset();
  verifyUtilityPaystackPayment.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('reconcileUtilityPaystackIntents', () => {
  it('selects only pending intents inside the age window, oldest first, capped', async () => {
    await reconcileUtilityPaystackIntents({ now: NOW, limit: 500 });

    const calls = supabase.calls;
    expect(calls).toContainEqual(['from', 'utility_paystack_intents']);
    expect(calls).toContainEqual(['eq', 'status', 'pending']);
    // Not younger than 10 minutes: the webhook, callback and app get first go.
    expect(calls).toContainEqual(['lt', 'created_at', '2026-10-10T11:50:00.000Z']);
    // Not older than 7 days: abandoned checkouts are not polled forever.
    expect(calls).toContainEqual(['gt', 'created_at', '2026-10-03T12:00:00.000Z']);
    expect(calls).toContainEqual(['order', 'created_at', { ascending: true }]);
    expect(calls).toContainEqual(['limit', 100]);
  });

  it('runs a paid intent through the idempotent verify path exactly once', async () => {
    supabase.rows = [intent('UTIL_PAID')];
    verifyPaystackPayment.mockResolvedValue({ success: true });
    verifyUtilityPaystackPayment.mockResolvedValue({ alreadyProcessed: false, transaction: { id: 'tx-1' } });

    const out = await reconcileUtilityPaystackIntents({ now: NOW });

    expect(verifyUtilityPaystackPayment).toHaveBeenCalledTimes(1);
    expect(verifyUtilityPaystackPayment).toHaveBeenCalledWith('UTIL_PAID');
    expect(out.results).toEqual([{ id: 'id-UTIL_PAID', reference: 'UTIL_PAID', outcome: 'completed' }]);
    expect(out).toMatchObject({ processed: 1, completed: 1, unpaid: 0, errors: 0 });
  });

  it('leaves an unpaid checkout untouched: never calls the vend path that would mark it failed', async () => {
    supabase.rows = [intent('UTIL_UNPAID')];
    verifyPaystackPayment.mockResolvedValue({ success: false, gatewayStatus: 'abandoned' });

    const out = await reconcileUtilityPaystackIntents({ now: NOW });

    expect(verifyUtilityPaystackPayment).not.toHaveBeenCalled();
    expect(out.results[0].outcome).toBe('unpaid');
    expect(out).toMatchObject({ unpaid: 1, completed: 0 });
  });

  it('reports an intent another path already finished as already_processed', async () => {
    supabase.rows = [intent('UTIL_DONE')];
    verifyPaystackPayment.mockResolvedValue({ success: true });
    verifyUtilityPaystackPayment.mockResolvedValue({ alreadyProcessed: true, transaction: { id: 'tx-9' } });

    const out = await reconcileUtilityPaystackIntents({ now: NOW });

    expect(out.results[0].outcome).toBe('already_processed');
    expect(out).toMatchObject({ alreadyProcessed: 1, completed: 0 });
  });

  it('one failing intent never aborts the rest, and its internal error text is not returned', async () => {
    supabase.rows = [intent('UTIL_BOOM'), intent('UTIL_OK')];
    verifyPaystackPayment.mockImplementation(async (ref: string) => {
      if (ref === 'UTIL_BOOM') throw new Error('PostgREST failure at internal-db-host.invalid');
      return { success: true };
    });
    verifyUtilityPaystackPayment.mockResolvedValue({ alreadyProcessed: false, transaction: { id: 'tx-2' } });

    const out = await reconcileUtilityPaystackIntents({ now: NOW });

    expect(out.results.map((r) => r.outcome)).toEqual(['error', 'completed']);
    expect(JSON.stringify(out)).not.toContain('internal-db-host.invalid');
    expect(out).toMatchObject({ processed: 2, completed: 1, errors: 1 });
  });

  it('counts a vend/refund failure during verify as an error, not a crash', async () => {
    supabase.rows = [intent('UTIL_VENDFAIL')];
    verifyPaystackPayment.mockResolvedValue({ success: true });
    verifyUtilityPaystackPayment.mockRejectedValue(new Error('provider down'));

    const out = await reconcileUtilityPaystackIntents({ now: NOW });

    expect(out.results[0].outcome).toBe('error');
  });

  it('throws when the intents cannot be loaded, so the scheduler sees a failure', async () => {
    supabase.error = { message: 'db down' };
    await expect(reconcileUtilityPaystackIntents({ now: NOW })).rejects.toThrow();
  });
});
