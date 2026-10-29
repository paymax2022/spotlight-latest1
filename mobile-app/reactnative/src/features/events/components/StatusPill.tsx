import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';

export interface PillStyle { label: string; color: string; bg: string }

// Look up a state in one of the badge maps in events.constants and fall back to
// the raw enum text. A money screen that swallowed an unknown state would hide a
// payment the customer can no longer name.
export function pillFor(map: Record<string, PillStyle>, state: string | undefined | null): PillStyle | null {
  if (!state) return null;
  return map[state] ?? { label: state, color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow };
}

// One state chip.
export default function StatusPill({ label, color, bg }: PillStyle) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full, alignSelf: 'flex-start', maxWidth: '60%' },
  text: { ...Typography.labelSm },
});
