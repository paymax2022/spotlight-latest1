// ── Registration — wizard step progress indicator ────────────────────────────

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  stepIndex: number;   // 0-based
  stepCount: number;
  title: string;
  description?: string;
}

export default function WizardProgress({ stepIndex, stepCount, title, description }: Props) {
  const pct = stepCount > 0 ? Math.round(((stepIndex + 1) / stepCount) * 100) : 0;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.counter}>Step {stepIndex + 1} of {stepCount}</Text>
        <Text style={styles.pct}>{pct}%</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, gap: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  counter: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pct: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginVertical: Spacing.xs },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.primary },
  title: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  description: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
});
