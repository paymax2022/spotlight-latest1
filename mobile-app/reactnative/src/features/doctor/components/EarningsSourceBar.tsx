import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  label:      string;            // source label
  amountKobo: number;            // money in kobo (formatted by formatValue)
  maxKobo:    number;            // largest source amount (for bar scale)
  consultCount?: number;
  tint?:      string;            // per-source token tint
  formatValue: (kobo: number) => string; // formatKobo, passed in (display only)
}

// New component (Y): a per-source earnings bar (label + tinted proportional bar +
// formatted amount). BarRow takes a points[] series with one shared tint and a
// 44px label column; the source breakdown needs a per-row tint, a consult count
// and a wider money column, so a dedicated source bar is justified (no deps).
export default function EarningsSourceBar({ label, amountKobo, maxKobo, consultCount, tint = Colors.primary, formatValue }: Props) {
  const pct = maxKobo > 0 ? Math.max(4, Math.round((amountKobo / maxKobo) * 100)) : 0;
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <Text style={styles.amount} numberOfLines={1}>{formatValue(amountKobo)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: tint }]} />
      </View>
      {typeof consultCount === 'number' && (
        <Text style={styles.meta}>{consultCount} {consultCount === 1 ? 'consult' : 'consults'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:   { gap: Spacing.xs, paddingVertical: Spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  label:  { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  amount: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  track:  { height: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill:   { height: '100%', borderRadius: Radius.full },
  meta:   { ...Typography.caption, color: Colors.onSurfaceVariant },
});
