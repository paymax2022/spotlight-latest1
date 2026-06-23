import { ApiError } from '@/src/lib/api/responses';
import type { UtilityProviderAdapter } from './types';
import { sandboxUtilityAdapter } from './sandbox';
import { vtpassUtilityAdapter } from './vtpass';

const adapters: Record<string, UtilityProviderAdapter> = {
  [sandboxUtilityAdapter.code]: sandboxUtilityAdapter,
  [vtpassUtilityAdapter.code]: vtpassUtilityAdapter,
};

export function getUtilityAdapter(adapterCode: string): UtilityProviderAdapter {
  const adapter = adapters[adapterCode];
  if (!adapter) throw new ApiError(`Utility provider adapter '${adapterCode}' is not registered.`, 500);
  return adapter;
}

export function listUtilityAdapterCodes() {
  return Object.keys(adapters);
}
