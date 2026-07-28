import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  label:      string;                  // benefit / cap label
  usedKobo:   number;                  // amount consumed (kobo)
  capKobo:    number;                  // annual / per-encounter cap (kobo)
  format:     (kobo: number) => string; // formatKobo passed in (display only)
  note?:      string;                  // "Generic drugs only", "Pre-auth required"
}

// New component: a "used vs cap" progress bar for HMO annual / benefit limits
// (Section O plan coverage). BarRow renders a value series scaled to its own max,
// not a single used/cap ratio with a remaining label, so a dedicated coverage
// bar is justified. Token-only; money formatted via the injected formatKobo.
export default function CoverageBar({ label, usedKobo, capKobo, format, note }: Props) {
  const pct = capKobo > 0 ? Math.min(100, Math.round((usedKobo / capKobo) * 100)) : 0;
  const over = capKobo > 0 && usedKobo >= capKobo;
  const tint = over ? Colors.error : pct >= 80 ? Colors.secondary : Colors.teal;
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <Text style={styles.value} numberOfLines={1}>{format(usedKobo)} / {format(capKobo)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(2, pct)}%`, backgroundColor: tint }]} />
      </View>
      <Text style={[styles.meta, over && styles.metaOver]} numberOfLines={1}>
        {over ? 'Annual limit reached' : `${format(Math.max(0, capKobo - usedKobo))} remaining`}{note ? ` · ${note}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:    { gap: Spacing.xs, paddingVertical: Spacing.sm },
  head:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  label:   { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  value:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  track:   { height: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill:    { height: '100%', borderRadius: Radius.full },
  meta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  metaOver:{ color: Colors.error },
});
