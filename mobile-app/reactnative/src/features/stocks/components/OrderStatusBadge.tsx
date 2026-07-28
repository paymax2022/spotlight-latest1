import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { STOCK_STATUS_STYLE } from '../constants/stocks.constants';

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

/**
 * Pill status chip for stock order statuses (mirrors crypto's CryptoStatusBadge).
 * Styling comes from STOCK_STATUS_STYLE (design tokens only).
 */
export default function OrderStatusBadge({ status, size = 'md' }: Props) {
  const style = STOCK_STATUS_STYLE[status] ?? STOCK_STATUS_STYLE.Submitted;
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
