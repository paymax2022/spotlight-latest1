/**
 * WAL-002: `settleTopupIntent` is the one place a wallet top-up is settled —
 * both the Paystack webhook and the verify-on-read fallback call it. It used
 * to update the intent row and stop there, with no notification firing on
 * success or failure. These tests prove the fix: a notification is dispatched
 * on every terminal outcome (success, amount mismatch, credit failure), it is
 * fire-and-forget (never awaited, never able to change settlement's own
 * return value), and a user with no billable email is skipped silently rather
 * than breaking settlement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

vi.mock('@/src/server/wallet/service', () => ({
  creditWallet: vi.fn(),
  resolveBillingEmail: vi.fn(),
}));

vi.mock('@/src/server/wallet/notifications', () => ({
  notifyTopupSuccess: vi.fn(),
  notifyTopupFailed: vi.fn(),
}));

import { settleTopupIntent, type TopupIntent } from '@/src/server/wallet/settle';
import { createAdminClient } from '@/lib/supabase/server';
import { creditWallet, resolveBillingEmail } from '@/src/server/wallet/service';
import { notifyTopupSuccess, notifyTopupFailed } from '@/src/server/wallet/notifications';

const INTENT: TopupIntent = {
  id: 'intent-1',
  user_id: 'user-1',
  amount_kobo: 50_000,
  status: 'pending',
  checkout_domain: null,
};

/** Flush the microtask queue so a fire-and-forget `void notify...()` settles. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mockUpdateChain() {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  return { update, eq };
}

describe('settleTopupIntent notifications (WAL-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifies success after a real credit, without affecting the settlement result', async () => {
    const { update } = mockUpdateChain();
    vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ update }) } as any);
    vi.mocked(creditWallet).mockResolvedValue(undefined as any);
    vi.mocked(resolveBillingEmail).mockResolvedValue('user@example.com');

    const result = await settleTopupIntent(INTENT, 50_000, 'REF-1');
    expect(result).toEqual({ settled: true, alreadySettled: false });

    await flush();
    expect(notifyTopupSuccess).toHaveBeenCalledWith({ to: 'user@example.com', amountKobo: 50_000, reference: 'REF-1' });
    expect(notifyTopupFailed).not.toHaveBeenCalled();
  });

  it('notifies failure on an amount mismatch, without affecting the settlement result', async () => {
    const { update } = mockUpdateChain();
    vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ update }) } as any);
    vi.mocked(resolveBillingEmail).mockResolvedValue('user@example.com');

    const result = await settleTopupIntent(INTENT, 40_000, 'REF-2');
    expect(result.settled).toBe(false);
    expect(result.error).toMatch(/Amount mismatch/);

    await flush();
    expect(notifyTopupFailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com', amountKobo: 50_000, reference: 'REF-2' }),
    );
    expect(notifyTopupSuccess).not.toHaveBeenCalled();
  });

  it('notifies failure when creditWallet throws, without affecting the settlement result', async () => {
    const { update } = mockUpdateChain();
    vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ update }) } as any);
    vi.mocked(creditWallet).mockRejectedValue(new Error('ledger: insufficient funds'));
    vi.mocked(resolveBillingEmail).mockResolvedValue('user@example.com');

    const result = await settleTopupIntent(INTENT, 50_000, 'REF-3');
    expect(result.settled).toBe(false);
    expect(result.error).toBe('ledger: insufficient funds');

    await flush();
    expect(notifyTopupFailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com', reference: 'REF-3', reason: 'ledger: insufficient funds' }),
    );
  });

  it('does not notify (or throw) when the intent is already settled', async () => {
    const alreadyCompleted: TopupIntent = { ...INTENT, status: 'completed' };

    const result = await settleTopupIntent(alreadyCompleted, 50_000, 'REF-4');
    expect(result).toEqual({ settled: true, alreadySettled: true });

    await flush();
    expect(notifyTopupSuccess).not.toHaveBeenCalled();
    expect(notifyTopupFailed).not.toHaveBeenCalled();
  });

  it('skips the notification silently when the user has no billable email, without affecting settlement', async () => {
    const { update } = mockUpdateChain();
    vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ update }) } as any);
    vi.mocked(creditWallet).mockResolvedValue(undefined as any);
    vi.mocked(resolveBillingEmail).mockRejectedValue(new Error('A valid email address is required'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await settleTopupIntent(INTENT, 50_000, 'REF-5');
    expect(result).toEqual({ settled: true, alreadySettled: false });

    await flush();
    expect(notifyTopupSuccess).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
