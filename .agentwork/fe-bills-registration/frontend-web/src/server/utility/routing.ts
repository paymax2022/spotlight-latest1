import { ApiError } from '@/src/lib/api/responses';
import type {
  UtilityCategory,
  UtilityProductMappingRow,
  UtilityProductRow,
  UtilityProviderRow,
} from './types';

export interface UtilityRouteCandidate {
  provider: UtilityProviderRow;
  mapping: UtilityProductMappingRow;
  priority: number;
}

export function selectUtilityProvider(
  candidates: UtilityRouteCandidate[],
  input: { category: UtilityCategory; product: UtilityProductRow; amountKobo: number },
): UtilityRouteCandidate {
  const viable = getViableUtilityRoutes(candidates, input);

  const selected = viable[0];
  if (!selected) {
    throw new ApiError('No available provider route for this utility product.', 503);
  }

  return selected;
}

export function getViableUtilityRoutes(
  candidates: UtilityRouteCandidate[],
  input: { category: UtilityCategory; product: UtilityProductRow; amountKobo: number },
): UtilityRouteCandidate[] {
  return candidates
    .filter((candidate) => candidate.provider.status === 'active')
    .filter((candidate) => candidate.mapping.status === 'active')
    .filter((candidate) => candidate.provider.health_status !== 'down')
    .filter((candidate) => candidate.provider.supported_categories.includes(input.category))
    .sort((a, b) => a.priority - b.priority || a.provider.priority - b.provider.priority);
}
