import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/server/admin/notifications', () => ({
  queueNotification: vi.fn((input) => ({ id: 'notification-001', status: 'sent', ...input })),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { queueNotification } from '@/src/server/admin/notifications';
import {
  notifyUtilityTransactionStatus,
  queueUtilityAdminAlert,
} from '@/src/server/utility/notifications';
import type { UtilityTransactionRow } from '@/src/server/utility/types';

function transaction(overrides: Partial<UtilityTransactionRow> = {}): UtilityTransactionRow {
  return {
    id: 'tx-utility-001',
    user_id: 'user-utility-001',
    category: 'electricity',
    biller_id: 'biller-001',
    product_id: 'product-001',
    provider_id: 'provider-001',
    provider_mapping_id: 'mapping-001',
    customer_reference: '12345678901',
    customer_name: 'Ada User',
    amount_kobo: 500_000,
    convenience_fee_kobo: 0,
    retail_amount_kobo: 500_000,
    provider_cost_kobo: 480_000,
    gross_profit_kobo: 20_000,
    gross_margin_bps: 400,
    status: 'successful',
    provider_reference: 'PROV-001',
    token: null,
    receipt_number: 'UTL-001',
    idempotency_key: 'UTILITY-key-001',
    failure_reason: null,
    provider_response: null,
    metadata: {},
    created_at: '2026-06-13T10:00:00.000Z',
    updated_at: '2026-06-13T10:00:00.000Z',
    ...overrides,
  };
}

describe('utility notifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queues customer notifications in applicant notifications', async () => {
    const { mock, insertFn } = makeSupabaseMock();
    vi.mocked(createAdminClient).mockReturnValue(mock as any);

    await notifyUtilityTransactionStatus(transaction({ token: '1234-5678-9012' }));

    expect(mock.from).toHaveBeenCalledWith('applicant_notifications');
    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-utility-001',
      service_type: 'utility_payment',
      application_id: 'tx-utility-001',
      title: 'Electricity token generated',
      type: 'success',
      link: '/utility?transaction=tx-utility-001',
      metadata: expect.objectContaining({
        utility_transaction_id: 'tx-utility-001',
        token_present: true,
      }),
    }));
  });

  it('uses admin notification queue for utility operational alerts', () => {
    queueUtilityAdminAlert({
      title: 'Utility transaction pending confirmation',
      message: 'UTL-001 is pending provider confirmation.',
      audience: 'support',
    });

    expect(queueNotification).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'in_app',
      audience: 'support',
      title: 'Utility transaction pending confirmation',
    }));
  });
});
