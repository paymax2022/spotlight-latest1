import { router } from 'expo-router';
import { confirmAsync } from '@/lib/confirm';

/**
 * Dialog form of the insufficient-balance CTA, for money paths that report the
 * refusal from a mutation callback (no inline error slot to render into).
 * Confirming opens the NGN wallet funding flow; cancelling leaves the user
 * where they were. Works on native and web via confirmAsync.
 */
export async function promptWalletTopUp(message: string): Promise<void> {
  const ok = await confirmAsync({
    title: 'Insufficient balance',
    message,
    confirmLabel: 'Top up wallet',
    cancelLabel: 'Not now',
  });
  if (ok) router.push('/wallet/add');
}