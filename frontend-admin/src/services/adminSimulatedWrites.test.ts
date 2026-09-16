// @vitest-environment node
/**
 * Controls with no backend must FAIL, not succeed.
 *
 * Step 2 of docs/audit/ADMIN_SIMULATED_WRITES.md. Each of these four actions had
 * a fixture branch that returned a success value: the operator approved a creator
 * payout, arbitrated an escrow fraud signal, bypassed a user's KYC or released a
 * referral payout, saw it confirmed, and nothing happened anywhere.
 *
 * None of the four endpoints exists server-side. There is no honest success to
 * return, so they now refuse — and these tests pin that, because "returns
 * success" is a state a future refactor could quietly restore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('backendless admin mutations refuse instead of faking success', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('creator payout decisions refuse', async () => {
    vi.stubEnv('NEXT_PUBLIC_CREATORS_USE_MOCK', 'true');
    const mod = await import('@/services/creatorsAdminService');
    await expect(mod.decidePayout('c1', 'approve')).rejects.toThrow(/not available|no backend/i);
  });

  it('escrow fraud actions refuse', async () => {
    const mod = await import('@/services/escrowAdminService');
    await expect(mod.decideEscrowFraud('e1', 'block')).rejects.toThrow(/not available|no backend/i);
  });

  it('KYC bypass refuses — and still validates its inputs first', async () => {
    const mod = await import('@/services/tradingAdminService');
    // The maker-checker validation is client-side and worth keeping: bad input
    // should fail on its own terms, not on "no backend".
    await expect(
      mod.bypassKyc('u1', { reason: '', checker_id: 'c', ttl_days: 1 } as never),
    ).rejects.toThrow(/justification/i);
    // With valid input, it refuses because the endpoint does not exist.
    await expect(
      mod.bypassKyc('u1', { reason: 'audited exception', checker_id: 'c2', ttl_days: 7 } as never),
    ).rejects.toThrow(/not available|no backend/i);
  });

  it('referral payout approval refuses', async () => {
    const mod = await import('@/services/referralAdminOpsService');
    await expect(mod.approvePayout('p1', 'ok')).rejects.toThrow(/not available|no backend/i);
  });

  it('refusing does not quietly hit the network either', async () => {
    // A refusal that still fired a request would be worse than the original bug:
    // an unexplained call plus an error the operator cannot act on.
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('@/services/escrowAdminService');
    await expect(mod.decideEscrowFraud('e1', 'clear')).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

/**
 * Step 3: the two services whose backends DO exist now talk to them by default.
 *
 * Both were one env var away from working, and both had a mutation that reported
 * a money outcome it had not produced: runSettlement returned 3 ("3 settlements
 * processed"), and adminDecideWithdrawal approved a crypto withdrawal into an
 * in-memory array.
 */
describe('services with real backends are live by default', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function mockFetch(body: unknown) {
    const fn = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('invest settlement run reaches the network instead of returning 3', async () => {
    const fetchFn = mockFetch({ processed: 0 });
    const mod = await import('@/services/investAdminService');
    const processed = await mod.runSettlement();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('/admin/invest/settlement/run');
    // The server's number, not the fixture's.
    expect(processed).toBe(0);
  });

  it('invest settlement run carries an Idempotency-Key', async () => {
    // It posts a settlement batch; a retry must not run it twice.
    const fetchFn = mockFetch({ processed: 1 });
    const mod = await import('@/services/investAdminService');
    await mod.runSettlement();
    const init = (fetchFn.mock.calls[0] as [string, RequestInit])[1];
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).some((k) => k.toLowerCase() === 'idempotency-key')).toBe(true);
  });

  it('crypto withdrawal decisions reach the network', async () => {
    const fetchFn = mockFetch({ withdrawal: { id: 'w1', status: 'pending' } });
    const mod = await import('@/services/cryptoAdminService');
    await mod.adminDecideWithdrawal('w1', { decision: 'approve', note: 'verified' } as never);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('/admin/crypto/withdrawals/w1/decision');
  });

  it('crypto withdrawal decisions still require an operator note', async () => {
    // Client-side guard that predates the flip; it must survive it.
    const fetchFn = mockFetch({});
    const mod = await import('@/services/cryptoAdminService');
    await expect(
      mod.adminDecideWithdrawal('w1', { decision: 'approve', note: '  ' } as never),
    ).rejects.toThrow(/note/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('both still serve fixtures when explicitly asked', async () => {
    vi.stubEnv('NEXT_PUBLIC_INVEST_ADMIN_USE_MOCK', 'true');
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const mod = await import('@/services/investAdminService');
    await mod.runSettlement();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
