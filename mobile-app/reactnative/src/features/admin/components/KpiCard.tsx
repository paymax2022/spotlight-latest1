// ── Paymax · Admin — KpiCard ─────────────────────────────────────────────────
// A dashboard KPI tile: label + big value + optional delta with an intent tone.
// Optional lucide icon glyph in a tinted tile.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';

type Intent = 'positive' | 'negative' | 'warning' | 'neutral';

interface Props {
  label: string;
  value: string;
  delta?: string;
  intent?: Intent;
  icon?: string; // lucide name
  iconColor?: string;
  iconBg?: string;
  onPress?: () => void;
}

const INTENT_COLOR: Record<Intent, string> = {
  positive: Colors.teal,
  negative: Colors.error,
  warning: Colors.onWarning,
  neutral: Colors.onSurfaceVariant,
};

export default function KpiCard({ label, value, delta, intent = 'neutral', icon, iconColor, iconBg, onPress }: Props) {
  const IconComponent = icon
    ? (Icons as unknown as Record<string, Icons.LucideIcon>)[icon]
    : undefined;

  const inner = (
    <View style={styles.card}>
      {IconComponent ? (
        <View style={[styles.iconTile, { backgroundColor: iconBg ?? Colors.iconBgPurple }]}>
          <IconComponent size={18} color={iconColor ?? Colors.primary} strokeWidth={2} />
        </View>
      ) : null}
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      {delta ? (
        <Text style={[styles.delta, { color: INTENT_COLOR[intent] }]} numberOfLines={1}>{delta}</Text>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}>
        {inner}
      </Pressable>
    );
  }
  return <View style={styles.wrap}>{inner}</View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  pressed: { opacity: 0.85 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    ...shadow1,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  value: { ...Typography.headlineMd, color: Colors.onSurface },
  delta: { ...Typography.labelSm },
});
