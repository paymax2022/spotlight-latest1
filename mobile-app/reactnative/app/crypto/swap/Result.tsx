import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import type { SwapOrderWire, SettlementStatus } from '@/features/crypto/types/swapWire';
import { resultHeadline, receivedLabel, settlementLabel, refundLabel, orderDetailLines } from '@/features/crypto/utils/swapDisplay';

interface Props {
  order: Pick<SwapOrderWire, 'id' | 'status'> & Partial<Pick<SwapOrderWire, 'to_units'>> & { swap_transaction_id?: string };
  settlement: SettlementStatus | null;
  toAssetId?: string;
}

/** Final outcome: success (received + settlement) or failure (refund info), with an order detail panel. */
export default function Result({ order, settlement, toAssetId = 'NGN' }: Props) {
  const [open, setOpen] = useState(false);
  const failed = order.status === 'failed';
  return (
    <View style={styles.card}>
      <Text style={[styles.title, failed && { color: Colors.error }]}>{resultHeadline(order.status)}</Text>
      {!failed && order.to_units != null ? <Text style={styles.receive}>{receivedLabel(order.to_units, toAssetId)}</Text> : null}
      <Text style={styles.sub}>{failed ? refundLabel(settlement) : settlementLabel(settlement)}</Text>
      <PrimaryButton label="View Details" variant="ghost" onPress={() => setOpen((o) => !o)} />
      {open ? orderDetailLines(order, settlement).map((l) => <Text key={l} style={styles.sub}>{l}</Text>) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  receive: { ...Typography.titleMd, color: Colors.primary },
  sub: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
