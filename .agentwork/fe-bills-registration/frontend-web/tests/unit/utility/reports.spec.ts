import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/server';
import { adminUtilityReport } from '@/src/server/utility/service';

function setupMock() {
  const { mock, listData } = makeSupabaseMock();
  vi.mocked(createAdminClient).mockReturnValue(mock as any);
  return { mock, listData };
}

describe('utility admin reports', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds provider performance from attempt rows', async () => {
    const { listData } = setupMock();
    listData.mockResolvedValueOnce({
      data: [
        { provider_id: 'provider-1', status: 'successful', duration_ms: 120 },
        { provider_id: 'provider-1', status: 'timeout', duration_ms: 1500 },
        { provider_id: 'provider-2', status: 'successful', duration_ms: 90 },
      ],
      error: null,
    });

    const report = await adminUtilityReport('provider-performance') as Array<Record<string, number | string>>;

    expect(report).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider_id: 'provider-1',
        attempts: 2,
        successful: 1,
        timeout: 1,
        average_duration_ms: 810,
        success_rate_bps: 5000,
      }),
      expect.objectContaining({
        provider_id: 'provider-2',
        attempts: 1,
        successful: 1,
        success_rate_bps: 10000,
      }),
    ]));
  });

  it('returns transaction-level rows for reconciliation', async () => {
    const { listData } = setupMock();
    listData.mockResolvedValueOnce({
      data: [
        {
          id: 'tx-001',
          receipt_number: 'UTL-001',
          status: 'successful',
          retail_amount_kobo: 100_000,
          provider_cost_kobo: 95_000,
          gross_profit_kobo: 5_000,
        },
      ],
      error: null,
    });

    const report = await adminUtilityReport('reconciliation') as Array<Record<string, unknown>>;

    expect(report).toHaveLength(1);
    expect(report[0].receipt_number).toBe('UTL-001');
    expect(report[0].gross_profit_kobo).toBe(5_000);
  });
});
