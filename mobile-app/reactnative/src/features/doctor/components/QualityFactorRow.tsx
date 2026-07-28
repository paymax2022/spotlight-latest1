import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  label:     string;
  scorePct:  number;             // 0–100
  weightPct?: number;            // contribution weight
  tint?:     string;             // bar fill token
  border?:   boolean;            // top divider when stacked
}

// New component (Z): a quality-score factor row (label + weight + scored bar +
// pct). BarRow uses a fixed scale across a series; a factor row is already 0–100
// and needs an inline weight chip, so a dedicated row is justified (token-only).
export default function QualityFactorRow({ label, scorePct, weightPct, tint = Colors.primary, border }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(scorePct)));
  return (
    <View style={[styles.wrap, border && styles.border]}>
      <View style={styles.header}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        {typeof weightPct === 'number' && <Text style={styles.weight}>{weightPct}% weight</Text>}
      </View>
      <View style={styles.row}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: tint }]} />
        </View>
        <Text style={styles.score}>{pct}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:   { gap: Spacing.xs, paddingVertical: Spacing.sm },
  border: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  label:  { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  weight: { ...Typography.caption, color: Colors.onSurfaceVariant },
  row:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  track:  { flex: 1, height: 10, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill:   { height: '100%', borderRadius: Radius.full },
  score:  { ...Typography.labelSm, color: Colors.onSurface, width: 40, textAlign: 'right', fontWeight: '700' },
});
