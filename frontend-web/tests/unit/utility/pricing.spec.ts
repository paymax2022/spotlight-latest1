import { describe, expect, it } from 'vitest';
import { calculateUtilityPricing, resolveUtilityAmount } from '@/src/server/utility/pricing';
import type { UtilityProductMappingRow, UtilityProductRow } from '@/src/server/utility/types';

const fixedProduct: UtilityProductRow = {
  id: 'product-1',
  biller_id: 'biller-1',
  category: 'data',
  name: '1GB Data',
  code: 'data-1gb',
  amount_type: 'fixed',
  amount_kobo: 100_000,
  min_amount_kobo: null,
  max_amount_kobo: null,
  convenience_fee_kobo: 5_000,
  markup_bps: 100,
  provider_discount_bps: 500,
  status: 'active',
  metadata: {},
};

const mapping: UtilityProductMappingRow = {
  id: 'mapping-1',
  provider_id: 'provider-1',
  product_id: 'product-1',
  provider_product_code: 'EXT_DATA_1GB',
  provider_biller_code: 'MTN',
  provider_cost_kobo: null,
  provider_discount_bps: 0,
  status: 'active',
};

describe('utility pricing', () => {
  it('calculates retail amount, provider cost, and gross profit in kobo', () => {
    const pricing = calculateUtilityPricing(fixedProduct, mapping);

    expect(pricing.amountKobo).toBe(100_000);
    expect(pricing.retailAmountKobo).toBe(106_000);
    expect(pricing.providerCostKobo).toBe(95_000);
    expect(pricing.grossProfitKobo).toBe(11_000);
    expect(pricing.grossMarginBps).toBe(1037);
  });

  it('uses mapping-specific provider cost when configured', () => {
    const pricing = calculateUtilityPricing(fixedProduct, { ...mapping, provider_cost_kobo: 90_000 });
    expect(pricing.providerCostKobo).toBe(90_000);
    expect(pricing.grossProfitKobo).toBe(16_000);
  });

  it('requires amount_kobo for variable products and enforces bounds', () => {
    const variable = {
      ...fixedProduct,
      amount_type: 'variable' as const,
      amount_kobo: null,
      min_amount_kobo: 10_000,
      max_amount_kobo: 200_000,
    };

    expect(() => resolveUtilityAmount(variable)).toThrow(/required/i);
    expect(() => resolveUtilityAmount(variable, 5_000)).toThrow(/minimum/i);
    expect(() => resolveUtilityAmount(variable, 250_000)).toThrow(/maximum/i);
    expect(resolveUtilityAmount(variable, 50_000)).toBe(50_000);
  });
});
