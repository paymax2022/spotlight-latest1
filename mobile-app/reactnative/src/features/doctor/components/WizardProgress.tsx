import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  current: number;   // 1-based step number
  total:   number;
  label?:  string;   // optional step name shown under the counter
}

// New component: a "Step x of n" header with a fill bar for the profile-builder
// wizard. No existing component renders a stepped progress indicator
// (StatusTimeline is a vertical event rail, not a horizontal wizard bar), so
// this is genuinely new.
export default function WizardProgress({ current, total, label }: Props) {
  const pct = Math.max(0, Math.min(1, current / total));
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.counter}>Step {current} of {total}</Text>
        {!!label && <Text style={styles.label} numberOfLines={1}>{label}</Text>}
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:      { gap: Spacing.xs, marginBottom: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  counter:   { ...Typography.labelMd, color: Colors.primary },
  label:     { ...Typography.caption, color: Colors.onSurfaceVariant, flexShrink: 1 },
  track:     { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill:      { height: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
});
