import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import type { SwapOrderWire } from '@/features/crypto/types/swapWire';
import { executionLabel, EXECUTION_TIMEOUT_MS } from '@/features/crypto/utils/swapDisplay';

interface Props {
  order: Pick<SwapOrderWire, 'id' | 'status'> & { swap_transaction_id?: string };
  onTimeout?: () => void;
}

/** Shows progress while the swap executes; errors out if the status doesn't change within 30s. */
export default function Execution({ order, onTimeout }: Props) {
  const [timedOut, setTimedOut] = useState(false);
  const cb = useRef(onTimeout);
  cb.current = onTimeout;

  useEffect(() => {
    if (order.status !== 'executing' && order.status !== 'pending') return;
    const t = setTimeout(() => { setTimedOut(true); cb.current?.(); }, EXECUTION_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [order.status]);

  if (timedOut) {
    return (
      <View style={styles.card}>
        <Text style={styles.error}>Swap failed</Text>
        <Text style={styles.sub}>We did not get a confirmation in time. Check your wallet before retrying.</Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <ActivityIndicator color={Colors.primary} />
      <Text style={styles.title}>{executionLabel(order.status)}</Text>
      {order.swap_transaction_id ? <Text style={styles.sub}>{order.swap_transaction_id}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, alignItems: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  error: { ...Typography.titleMd, color: Colors.error },
});
