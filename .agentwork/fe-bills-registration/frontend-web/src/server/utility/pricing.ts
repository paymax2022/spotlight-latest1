import { ApiError } from '@/src/lib/api/responses';
import { validateAmountKobo } from '@/src/server/wallet/ledger';
import type { UtilityPricing, UtilityProductMappingRow, UtilityProductRow } from './types';

function applyBasisPoints(amountKobo: number, bps: number) {
  return Math.floor((amountKobo * bps) / 10_000);
}

export function resolveUtilityAmount(product: UtilityProductRow, requestedAmountKobo?: number): number {
  const amountKobo = product.amount_type === 'fixed' ? product.amount_kobo : requestedAmountKobo;
  if (typeof amountKobo !== 'number') {
    throw new ApiError('amount_kobo is required for variable utility products.', 400);
  }

  validateAmountKobo(amountKobo);

  if (product.min_amount_kobo !== null && amountKobo < product.min_amount_kobo) {
    throw new ApiError(`Minimum amount is ${product.min_amount_kobo} kobo.`, 400);
  }

  if (product.max_amount_kobo !== null && amountKobo > product.max_amount_kobo) {
    throw new ApiError(`Maximum amount is ${product.max_amount_kobo} kobo.`, 400);
  }

  return amountKobo;
}

export function calculateUtilityPricing(
  product: UtilityProductRow,
  mapping: UtilityProductMappingRow,
  requestedAmountKobo?: number,
): UtilityPricing {
  const amountKobo = resolveUtilityAmount(product, requestedAmountKobo);
  const markupKobo = applyBasisPoints(amountKobo, product.markup_bps);
  const convenienceFeeKobo = product.convenience_fee_kobo;
  const retailAmountKobo = amountKobo + markupKobo + convenienceFeeKobo;
  const discountBps = mapping.provider_discount_bps || product.provider_discount_bps;
  const providerCostKobo = mapping.provider_cost_kobo ?? amountKobo - applyBasisPoints(amountKobo, discountBps);
  const grossProfitKobo = retailAmountKobo - providerCostKobo;
  const grossMarginBps = retailAmountKobo > 0 ? Math.floor((grossProfitKobo * 10_000) / retailAmountKobo) : 0;

  if (providerCostKobo <= 0) {
    throw new ApiError('Provider cost must be positive.', 500);
  }

  return {
    amountKobo,
    convenienceFeeKobo,
    retailAmountKobo,
    providerCostKobo,
    grossProfitKobo,
    grossMarginBps,
  };
}
