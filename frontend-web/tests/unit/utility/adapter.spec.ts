import { describe, expect, it } from 'vitest';
import { sandboxUtilityAdapter } from '@/src/server/utility/adapters/sandbox';

describe('sandbox utility adapter', () => {
  it('returns successful purchases by default', async () => {
    const result = await sandboxUtilityAdapter.purchase({
      transactionId: 'tx-1',
      idempotencyKey: 'key-1',
      category: 'airtime',
      billerCode: 'mtn',
      productCode: 'airtime',
      providerProductCode: 'MTN_AIRTIME',
      customerReference: '08030000000',
      pricing: {
        amountKobo: 100_000,
        convenienceFeeKobo: 0,
        retailAmountKobo: 100_000,
        providerCostKobo: 97_000,
        grossProfitKobo: 3_000,
        grossMarginBps: 300,
      },
    });

    expect(result.status).toBe('successful');
    expect(result.providerReference).toContain('SBX-');
  });

  it('classifies pending and failed references for reliability tests', async () => {
    const pending = await sandboxUtilityAdapter.validateCustomer({
      category: 'electricity',
      billerCode: 'ikeja-electric',
      customerReference: 'pending-meter',
    });
    const invalid = await sandboxUtilityAdapter.validateCustomer({
      category: 'electricity',
      billerCode: 'ikeja-electric',
      customerReference: 'invalid-meter',
    });

    expect(pending.valid).toBe(true);
    expect(invalid.valid).toBe(false);
  });
});
