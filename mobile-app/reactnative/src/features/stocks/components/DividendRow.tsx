import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Coins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatMoneyObj, formatDateTime } from '../utils/stockFormatters';
import type { Dividend } from '../types/stocks.types';

interface Props {
  dividend: Dividend;
}

/** Dividend row: icon · per-share amount/ex-date · paid/announced chip. */
export default function DividendRow({ dividend }: Props) {
  const paid = dividend.status === 'paid';
  return (
    <View style={styles.row}>
      <View style={styles.iconBox}>
        <Coins size={18} color={Colors.teal} strokeWidth={2} />
      </View>
      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={1}>{formatMoneyObj(dividend.amountPerShare)} / share</Text>
        <Text style={styles.sub} numberOfLines={1}>Ex-date {formatDateTime(dividend.exDate)}</Text>
      </View>
      <View style={[styles.pill, { backgroundColor: paid ? Colors.iconBgTeal : Colors.iconBgGold }]}>
        <Text style={[styles.pillText, { color: paid ? Colors.tertiaryContainer : Colors.onWarning }]}>
          {paid ? 'Paid' : 'Announced'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  iconBox: {
    width: 42, height: 42, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgTeal,
  },
  mid: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  pill: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5, alignSelf: 'center' },
  pillText: { ...Typography.labelSm, fontWeight: '600' as const },
});
