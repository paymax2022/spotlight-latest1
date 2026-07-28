import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Point { label: string; value: number }

interface Props {
  title?:      string;
  points:      Point[];
  formatValue?: (v: number) => string;   // e.g. formatKobo for earnings trend
  tint?:       string;                    // bar fill colour (token)
}

// New component: a pure-RN horizontal bar chart for the analytics time series
// (rating / response / volume / earnings trends). No charting dependency exists
// and nothing in the barrel renders a labelled value series, so this token-only
// bar list is justified (no new npm deps added).
export default function BarRow({ title, points, formatValue, tint = Colors.primary }: Props) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <View style={styles.wrap}>
      {!!title && <Text style={styles.title}>{title}</Text>}
      {points.map((p) => {
        const pct = Math.max(4, Math.round((p.value / max) * 100));
        return (
          <View key={p.label} style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>{p.label}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%`, backgroundColor: tint }]} />
            </View>
            <Text style={styles.value} numberOfLines={1}>{formatValue ? formatValue(p.value) : String(p.value)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:  { gap: Spacing.sm },
  title: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  row:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant, width: 44 },
  track: { flex: 1, height: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: Radius.full },
  value: { ...Typography.labelSm, color: Colors.onSurface, width: 76, textAlign: 'right' },
});
