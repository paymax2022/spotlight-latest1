import React from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { Colors, Typography, Spacing } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { confirmAsync } from '@/lib/confirm';
import { useCancelOrder } from '@/features/health/pharmacy/hooks';
import { newIdempotencyKey } from '@/features/health/pharmacy/cartStore';
import { isCancellable } from '@/features/health/pharmacy/api';
import type { PharmacyOrder } from '@/features/health/pharmacy/types';

/**
 * Patient cancel for a pre-dispense order (HL-9: the held payment is refunded).
 * Renders nothing once the order is dispensed — the backend rejects it then.
 */
export default function PharmacyCancelOrderButton({ order }: { order: PharmacyOrder }) {
  const cancel = useCancelOrder();
  if (!isCancellable(order.status)) return null;

  const onPress = async () => {
    const ok = await confirmAsync({
      title: 'Cancel this order?',
      message: 'Your held payment will be refunded to your wallet.',
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep order',
      destructive: true,
    });
    if (!ok) return;
    cancel.mutate({ orderId: order.id, idempotencyKey: newIdempotencyKey('cancel') });
  };

  return (
    <View style={styles.wrap}>
      <PrimaryButton label="Cancel order" variant="danger" onPress={onPress} loading={cancel.isPending} />
      {cancel.isError ? (
        <Text style={styles.err}>Couldn't cancel this order. It may already be with the pharmacist.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  err: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
});
