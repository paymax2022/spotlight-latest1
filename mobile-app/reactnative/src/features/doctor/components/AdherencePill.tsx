import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

interface Props {
  label: string;
  tone:  Tone;
}

// New component: a small adherence-level pill (Section Q). StatusBadge covers
// status unions but its tone set differs from the adherence ADHERENCE_OPTIONS
// tone strings; this pill maps the {label,tone} option shape directly so the
// adherence rows read consistently without re-mapping at every call site.
const TONE: Record<Tone, { fg: string; bg: string }> = {
  success: { fg: Colors.teal,             bg: Colors.iconBgTeal },
  warning: { fg: Colors.secondary,        bg: Colors.iconBgBlue },
  danger:  { fg: Colors.error,            bg: Colors.errorContainer },
  info:    { fg: Colors.secondary,        bg: Colors.iconBgBlue },
  muted:   { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow },
};

export default function AdherencePill({ label, tone }: Props) {
  const c = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { height: 26, paddingHorizontal: 10, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  text: { ...Typography.labelSm, fontWeight: '700' },
});
