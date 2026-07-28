import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { CRYPTO_STATUS_STYLE } from '../constants/crypto.constants';

interface Props {
  status: string;
  size?: 'sm' | 'md';
}

/**
 * Pill status chip for crypto order/transaction statuses (mirrors fx
 * TxStatusBadge). Styling comes from CRYPTO_STATUS_STYLE (design tokens only).
 */
export default function CryptoStatusBadge({ status, size = 'md' }: Props) {
  const style = CRYPTO_STATUS_STYLE[status] ?? CRYPTO_STATUS_STYLE.Processing;
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
