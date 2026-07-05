import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatNaira, StaysColors } from '../constants/stays.constants';
import type { PriceBreakdownData } from '../types';

interface Props {
  data: PriceBreakdownData;
  /** Hide the FX note (e.g. when shown separately). */
  hideFxNote?: boolean;
}

/**
 * Itemised price breakdown (room, taxes, fees, add-ons, discounts) with the
 * NGN total the wallet/ledger actually moves, plus the FX note when the display
 * currency is not NGN. Reused on review, price-breakdown and confirm screens.
 */
export default function PriceBreakdown({ data, hideFxNote }: Props) {
  return (
    <View style={styles.card}>
      {data.lines.map((l, i) => {
        const discount = l.amountKobo < 0;
        return (
          <View key={`${l.label}-${i}`} style={styles.row}>
            <View style={styles.labelWrap}>
              <Text style={[styles.label, l.kind === 'discount' && styles.discountLabel]} numberOfLines={2}>
                {l.label}
              </Text>
              {l.note ? <Text style={styles.note}>{l.note}</Text> : null}
            </View>
            <Text style={[styles.amount, discount && styles.discountAmount]}>
              {discount ? '-' : ''}{formatNaira(Math.abs(l.amountKobo))}
            </Text>
          </View>
        );
      })}

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.totalLabel}>Total (NGN)</Text>
        <Text style={styles.totalAmount}>{formatNaira(data.totalKobo)}</Text>
      </View>

      {!hideFxNote && data.fxNote ? (
        <View style={styles.fxRow}>
          <Info size={14} color={StaysColors.accent} strokeWidth={2} />
          <Text style={styles.fxText}>{data.fxNote}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  labelWrap: { flex: 1 },
  label: { ...Typography.bodySm, color: Colors.onSurface },
  discountLabel: { color: StaysColors.ok },
  note: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  amount: { ...Typography.bodySm, color: Colors.onSurface, fontWeight: '600' as const },
  discountAmount: { color: StaysColors.ok },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: 2 },
  totalLabel: { ...Typography.titleMd, color: Colors.onSurface },
  totalAmount: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  fxRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgBlue,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  fxText: { ...Typography.caption, color: Colors.onSurface, flex: 1, lineHeight: 16 },
});
