import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { CapTableSlice } from '../types';

const PALETTE = [Colors.primary, Colors.secondary, Colors.teal, Colors.gold, Colors.error];

/** Compact stacked cap-table bar + legend. */
export default function CapTableMini({ slices }: { slices: CapTableSlice[] }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        {slices.map((s, i) => (
          <View key={s.label} style={{ width: `${s.pct}%`, backgroundColor: PALETTE[i % PALETTE.length] }} />
        ))}
      </View>
      <View style={styles.legend}>
        {slices.map((s, i) => (
          <View key={s.label} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
            <Text style={styles.legendLabel}>{s.label}</Text>
            <Text style={styles.legendPct}>{s.pct}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  bar: { flexDirection: 'row', height: 14, borderRadius: Radius.full, overflow: 'hidden', backgroundColor: Colors.surfaceContainerHigh },
  legend: { gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  legendPct: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
