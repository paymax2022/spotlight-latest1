import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { TX_STATUS_STYLE } from '../constants/fx.constants';

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

/**
 * Pill-shaped status chip (DESIGN-Mobile.md → Chips & Badges: high-contrast text
 * on a 10% tint). Styling comes from TX_STATUS_STYLE (design tokens only).
 * Modeled on crowdfunding's CampaignStatusBadge for visual consistency.
 */
export default function TxStatusBadge({ status, size = 'md' }: Props) {
  const style = TX_STATUS_STYLE[status] ?? TX_STATUS_STYLE.pending;
  return (
    <View style={[styles.pill, size === 'sm' && styles.pillSm, { backgroundColor: style.bg }]}>
      <View style={[styles.dot, { backgroundColor: style.fg }]} />
      <Text style={[styles.label, size === 'sm' && styles.labelSm, { color: style.fg }]}>{style.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  pillSm: { paddingVertical: 3, paddingHorizontal: 7 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '600' as const },
  labelSm: { ...Typography.caption, fontWeight: '600' as const },
});
