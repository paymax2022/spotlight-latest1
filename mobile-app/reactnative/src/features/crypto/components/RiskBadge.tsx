import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { RISK_STYLE } from '../constants/crypto.constants';
import type { RiskRating } from '../types/crypto.types';

interface Props {
  rating: RiskRating;
  size?: 'sm' | 'md';
}

/** Pill-shaped risk-rating chip (DESIGN-Mobile.md → Chips & Badges). */
export default function RiskBadge({ rating, size = 'md' }: Props) {
  const style = RISK_STYLE[rating];
  return (
    <View style={[styles.pill, size === 'sm' && styles.pillSm, { backgroundColor: style.bg }]}>
      <Text style={[styles.label, size === 'sm' && styles.labelSm, { color: style.fg }]}>{style.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  pillSm: { paddingVertical: 3, paddingHorizontal: 7 },
  label: { ...Typography.labelSm, fontWeight: '600' as const },
  labelSm: { ...Typography.caption, fontWeight: '600' as const },
});
