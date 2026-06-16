import type { UtilityTransactionStatus } from './types';

const terminalStatuses: ReadonlySet<UtilityTransactionStatus> = new Set([
  'successful',
  'failed',
  'reversed',
]);

export function isTerminalUtilityStatus(status: UtilityTransactionStatus) {
  return terminalStatuses.has(status);
}

export function canRequeryUtilityStatus(status: UtilityTransactionStatus) {
  return status === 'provider_pending' || status === 'wallet_debited' || status === 'initiated';
}

export function canReverseUtilityTransaction(status: UtilityTransactionStatus) {
  return status === 'failed' || status === 'provider_pending' || status === 'wallet_debited';
}

export function nextStatusFromProvider(providerStatus: 'successful' | 'pending' | 'failed'): UtilityTransactionStatus {
  if (providerStatus === 'successful') return 'successful';
  if (providerStatus === 'pending') return 'provider_pending';
  return 'failed';
}
