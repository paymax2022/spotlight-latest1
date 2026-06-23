import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  label: string;
  value: number;
  max: number;
  color?: string;
  suffix?: string;
}

/** Horizontal proportional bar for simple analytics breakdowns (no chart dep). */
export default function MetricBar({ label, value, max, color = Colors.secondary, suffix = '' }: Props) {
  const pct = max > 0 ? Math.max(0.04, Math.min(1, value / max)) : 0;
  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.value}>{value}{suffix}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 5 },
  label: { ...Typography.bodySm, color: Colors.onSurfaceVariant, width: 84 },
  track: { flex: 1, height: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, overflow: 'hidden' },
  fill: { height: 10, borderRadius: Radius.full },
  value: { ...Typography.labelMd, color: Colors.onSurface, width: 44, textAlign: 'right' },
});
