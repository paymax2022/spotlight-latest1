import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';

interface Props {
  label: string;
  tone?: BadgeTone;
  style?: ViewStyle;
}

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  ok:      { bg: Colors.iconBgTeal,   fg: Colors.tertiaryContainer },
  warn:    { bg: Colors.iconBgGold,   fg: Colors.onWarning },
  danger:  { bg: Colors.errorContainer, fg: Colors.error },
  neutral: { bg: Colors.surfaceContainer, fg: Colors.onSurfaceVariant },
  accent:  { bg: Colors.iconBgBlue,   fg: Colors.secondary },
};

/**
 * Small status pill (attribution status, fraud standing, generic states).
 * Reused across referral screens so status colours are consistent.
 */
export default function StateBadge({ label, tone = 'neutral', style }: Props) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]}>
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  label: { ...Typography.labelSm, fontWeight: '700' as const },
});
