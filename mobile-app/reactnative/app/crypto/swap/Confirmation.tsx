import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import type { SwapOrderWire } from '@/features/crypto/types/swapWire';
import { formatUnits, feeLabel, spreadLabel } from '@/features/crypto/utils/swapDisplay';

interface Props {
  order: Pick<SwapOrderWire, 'from_units' | 'to_units' | 'spread_kobo' | 'spread_bps'>;
  fromAssetId?: string;
  toAssetId?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Final confirmation: amounts, fee breakdown, Confirm Swap / Cancel. */
export default function Confirmation({ order, fromAssetId = 'USDT', toAssetId = 'NGN', loading, onConfirm, onCancel }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>You swap</Text>
      <Text style={styles.amount}>{formatUnits(order.from_units)} {fromAssetId.toUpperCase()}</Text>
      <Text style={styles.receive}>You will receive {formatUnits(order.to_units)} {toAssetId.toUpperCase()}</Text>
      <View style={styles.fees}>
        <Text style={styles.fee}>{feeLabel(order.spread_kobo)}</Text>
        <Text style={styles.fee}>Spread: {spreadLabel(order.spread_bps)}</Text>
      </View>
      <PrimaryButton label="Confirm Swap" onPress={onConfirm} loading={loading} />
      <PrimaryButton label="Cancel" variant="ghost" onPress={onCancel} disabled={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amount: { ...Typography.headlineMd, color: Colors.onSurface },
  receive: { ...Typography.titleMd, color: Colors.primary, marginBottom: Spacing.sm },
  fees: { gap: 2, marginBottom: Spacing.md },
  fee: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
