import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { STOCK_FEE_LABEL, SIDE_LABEL } from '../constants/stocks.constants';
import { formatMoneyObj, formatShares } from '../utils/stockFormatters';
import type { OrderEstimate } from '../types/stocks.types';

interface Props {
  estimate: OrderEstimate;
}

/**
 * Itemised order summary + fee transparency for the trade-confirmation screen.
 * Every fee is shown explicitly — "never hide fees". Mirrors CryptoQuoteBreakdown.
 */
export default function OrderBreakdown({ estimate }: Props) {
  const buy = estimate.side === 'buy';
  const unitPrice = estimate.limitPrice ?? estimate.estPrice;
  return (
    <View style={styles.card}>
      <Row label="Order" value={`${SIDE_LABEL[estimate.side]} · ${estimate.orderType === 'limit' ? 'Limit' : 'Market'}`} />
      <Row label="Shares" value={formatShares(estimate.quantity)} />
      <Row
        label={estimate.orderType === 'limit' ? 'Limit price' : 'Est. price'}
        value={`${formatMoneyObj(unitPrice)} / share`}
      />
      <Row label="Gross" value={formatMoneyObj(estimate.gross)} />

      <View style={styles.divider} />

      {estimate.fees
        .filter((f) => f.amount.amount > 0)
        .map((f) => (
          <Row key={f.type} label={STOCK_FEE_LABEL[f.type] ?? f.type} value={formatMoneyObj(f.amount)} muted />
        ))}

      <View style={styles.divider} />

      <Row label={buy ? 'Total to pay' : 'Total you get'} value={formatMoneyObj(estimate.total)} emphasis />
      <Row label="Settlement" value={estimate.settlementCycle} muted />

      <View style={styles.routeNote}>
        <Info size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.routeText}>
          {estimate.orderType === 'limit'
            ? 'Limit orders fill only at your price or better. The final amount can differ if the order fills partially.'
            : 'Market orders fill at the best available price, which can vary slightly from the estimate shown.'}
        </Text>
      </View>
    </View>
  );
}

function Row({ label, value, emphasis, muted }: { label: string; value: string; emphasis?: boolean; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, muted && styles.muted]}>{label}</Text>
      <Text style={[styles.value, emphasis && styles.emphasis, muted && styles.mutedValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  label: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 1 },
  value: { ...Typography.labelLg, color: Colors.onSurface, textAlign: 'right', flexShrink: 1 },
  emphasis: { color: Colors.primary },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  mutedValue: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  routeNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surfaceContainer, borderRadius: Radius.md,
    padding: Spacing.sm, marginTop: 2,
  },
  routeText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
});
