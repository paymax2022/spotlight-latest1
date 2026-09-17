/**
 * reverseUtilityTransaction — payment_source guard.
 *
 * A utility transaction is funded either from the in-app wallet
 * (payment_source: 'wallet', debited via the ledger at purchase time) or
 * directly via Paystack (payment_source: 'paystack', never touches the
 * ledger). Admin reversal must only credit the wallet back for the wallet
 * case — crediting it for a Paystack-funded transaction would fabricate an
 * unbacked wallet credit on top of whatever refund support later issues via
 * Paystack out-of-band. Same policy as the voting module's vote-reversal
 * route (see app/api/admin/voting/votes/[voteId]/reverse/route.ts).
 *
 * Hermetic: Supabase, wallet ledger, and notifications are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/wallet/service', () => ({
  debitWallet: vi.fn(),
  reverseWalletDebit: vi.fn(),
}));

vi.mock('@/src/server/utility/notifications', () => ({
  notifyUtilityCustomer: vi.fn(),
  notifyUtilityTransactionStatus: vi.fn(),
  queueUtilityAdminAlert: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { reverseWalletDebit } from '@/src/server/wallet/service';
import { reverseUtilityTransaction } from '@/src/server/utility/service';
import type { UtilityTransactionRow } from '@/src/server/utility/types';

function transaction(overrides: Partial<UtilityTransactionRow> = {}): UtilityTransactionRow {
  return {
    id: 'tx-utility-900',
    user_id: 'user-utility-900',
    category: 'airtime',
    biller_id: 'biller-001',
    product_id: 'product-001',
    provider_id: 'provider-001',
    provider_mapping_id: 'mapping-001',
    customer_reference: '+2348011111111',
    customer_name: null,
    amount_kobo: 100_000,
    convenience_fee_kobo: 0,
    retail_amount_kobo: 100_000,
    provider_cost_kobo: 100_000,
    gross_profit_kobo: 0,
    gross_margin_bps: 0,
    status: 'failed',
    provider_reference: null,
    token: null,
    receipt_number: 'UTL-900',
    idempotency_key: 'UTILITY-key-900',
    payment_source: 'wallet',
    failure_reason: 'Sandbox: meter not recognised.',
    provider_response: { failover_exhausted: true },
    metadata: {},
    created_at: '2026-09-17T00:27:10.000Z',
    updated_at: '2026-09-17T00:27:10.000Z',
    ...overrides,
  };
}

describe('reverseUtilityTransaction payment_source guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reverseWalletDebit).mockResolvedValue({ alreadyProcessed: false, amountKobo: 100_000 } as any);
  });

  it('credits the wallet back for a wallet-funded failed transaction', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValue({ data: transaction({ status: 'reversed' }), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const tx = transaction({ payment_source: 'wallet' });
    await reverseUtilityTransaction(tx, 'Provider failure confirmed');

    expect(reverseWalletDebit).toHaveBeenCalledTimes(1);
    expect(reverseWalletDebit).toHaveBeenCalledWith('user-utility-900', expect.objectContaining({
      amountKobo: 100_000,
      idempotencyKey: 'utility:tx-utility-900:ADMIN_REVERSAL_DEBIT',
    }));
  });

  it('does NOT credit the wallet for a Paystack-funded failed transaction (no fabricated credit)', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValue({ data: transaction({ status: 'reversed', payment_source: 'paystack' }), error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    const tx = transaction({ payment_source: 'paystack' });
    const updated = await reverseUtilityTransaction(tx, 'Sandbox test intent — no real Paystack charge to refund');

    expect(reverseWalletDebit).not.toHaveBeenCalled();
    expect(updated.status).toBe('reversed');
  });

  it('rejects reversal of a transaction not in an eligible status', async () => {
    const tx = transaction({ status: 'successful' });
    await expect(reverseUtilityTransaction(tx, 'reason')).rejects.toThrow('Transaction is not eligible for reversal.');
    expect(reverseWalletDebit).not.toHaveBeenCalled();
  });
});
