// ── Paymax · Admin — ToggleRow ───────────────────────────────────────────────
// Label (+ optional sublabel) with a controlled switch built from Pressable so
// styling stays inside the design system (no platform Switch chrome). Animation-
// free; the track/knob colours come from design tokens.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  label: string;
  sublabel?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}

export default function ToggleRow({ label, sublabel, value, onChange, disabled, last }: Props) {
  return (
    <View style={[styles.row, !last && styles.border]}>
      <View style={styles.left}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        {sublabel ? <Text style={styles.sublabel} numberOfLines={2}>{sublabel}</Text> : null}
      </View>
      <Pressable
        onPress={() => !disabled && onChange(!value)}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        style={[styles.track, value ? styles.trackOn : styles.trackOff, disabled && styles.disabled]}
      >
        <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  left: { flex: 1, gap: 2 },
  label: { ...Typography.bodyMd, color: Colors.onSurface },
  sublabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  track: {
    width: 48,
    height: 28,
    borderRadius: Radius.full,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: Colors.primary },
  trackOff: { backgroundColor: Colors.surfaceContainerHighest },
  disabled: { opacity: 0.4 },
  knob: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
  },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },
});
