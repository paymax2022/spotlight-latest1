import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { MARKET_STATUS_STYLE } from '../constants/stocks.constants';
import type { MarketStatus } from '../types/stocks.types';

interface Props {
  status: MarketStatus;
  size?: 'sm' | 'md';
}

/** Pill chip showing whether the exchange is open / closed / pre / post. */
export default function MarketStatusBadge({ status, size = 'md' }: Props) {
  const style = MARKET_STATUS_STYLE[status];
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
