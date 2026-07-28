import { describe, expect, it } from 'vitest';
import { getViableUtilityRoutes, selectUtilityProvider, type UtilityRouteCandidate } from '@/src/server/utility/routing';
import type { UtilityProductRow, UtilityProviderRow } from '@/src/server/utility/types';

const product: UtilityProductRow = {
  id: 'product-1',
  biller_id: 'biller-1',
  category: 'airtime',
  name: 'Airtime',
  code: 'airtime',
  amount_type: 'variable',
  amount_kobo: null,
  min_amount_kobo: 5_000,
  max_amount_kobo: 500_000,
  convenience_fee_kobo: 0,
  markup_bps: 0,
  provider_discount_bps: 300,
  status: 'active',
  metadata: {},
};

function candidate(id: string, priority: number, provider: Partial<UtilityProviderRow> = {}): UtilityRouteCandidate {
  return {
    priority,
    provider: {
      id,
      name: id,
      code: id,
      adapter_code: 'sandbox',
      status: 'active',
      supported_categories: ['airtime'],
      priority: 100,
      health_status: 'healthy',
      credentials: null,
      config: {},
      ...provider,
    },
    mapping: {
      id: `mapping-${id}`,
      provider_id: id,
      product_id: product.id,
      provider_product_code: `EXT-${id}`,
      provider_biller_code: null,
      provider_cost_kobo: null,
      provider_discount_bps: 0,
      status: 'active',
    },
  };
}

describe('utility provider routing', () => {
  it('selects the lowest-priority healthy active provider', () => {
    const selected = selectUtilityProvider(
      [candidate('backup', 20), candidate('primary', 10)],
      { category: 'airtime', product, amountKobo: 100_000 },
    );

    expect(selected.provider.id).toBe('primary');
  });

  it('fails over providers marked down or disabled', () => {
    const selected = selectUtilityProvider(
      [
        candidate('primary', 10, { health_status: 'down' }),
        candidate('backup', 20),
      ],
      { category: 'airtime', product, amountKobo: 100_000 },
    );

    expect(selected.provider.id).toBe('backup');
  });

  it('throws when no provider can fulfill the product', () => {
    expect(() => selectUtilityProvider(
      [candidate('primary', 10, { status: 'disabled' })],
      { category: 'airtime', product, amountKobo: 100_000 },
    )).toThrow(/no available provider/i);
  });

  it('returns all viable routes in failover order', () => {
    const routes = getViableUtilityRoutes(
      [
        candidate('disabled', 1, { status: 'disabled' }),
        candidate('backup', 20),
        candidate('primary', 10),
      ],
      { category: 'airtime', product, amountKobo: 100_000 },
    );

    expect(routes.map((route) => route.provider.id)).toEqual(['primary', 'backup']);
  });
});
