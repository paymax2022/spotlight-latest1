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
