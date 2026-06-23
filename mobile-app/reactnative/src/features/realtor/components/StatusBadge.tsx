import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

export type Tone = 'success' | 'info' | 'neutral' | 'warning' | 'error';

interface Props {
  label: string;
  tone?: Tone;
  icon?: string;          // lucide name
  style?: ViewStyle;
}

/**
 * Pill status chip (DESIGN-Mobile.md → Chips & Badges: pill-shaped, high-contrast
 * text on a 10%-opacity background). Drives every status surface in the realtor
 * module — verification level, listing/inspection/application status.
 */
const TONE: Record<Tone, { fg: string; bg: string }> = {
  success: { fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  info: { fg: Colors.secondary, bg: Colors.iconBgBlue },
  neutral: { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  warning: { fg: Colors.onWarning, bg: Colors.iconBgGold },
  error: { fg: Colors.error, bg: Colors.errorContainer },
};

export default function StatusBadge({ label, tone = 'neutral', icon, style }: Props) {
  const t = TONE[tone];
  const IconCmp = icon
    ? (Icons as unknown as Record<string, Icons.LucideIcon>)[icon]
    : undefined;
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }, style]}>
      {IconCmp ? <IconCmp size={12} color={t.fg} strokeWidth={2.2} /> : null}
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  label: { ...Typography.labelSm, fontWeight: '700' as const },
});
