import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { RX_STATUS_META, ORDER_STATUS_META } from '../pharmacy/constants';
import type { RxStatus, OrderStatus } from '../pharmacy/types';

/**
 * Pill badge for an Rx status (HL-3) or an order status (HL-9 lifecycle).
 * Pass exactly one of `rx` / `order`.
 */
export default function PharmacyStatusPill({ rx, order }: { rx?: RxStatus; order?: OrderStatus }) {
  const meta: { label: string; color: string; bg: string; icon?: string } | null = rx
    ? RX_STATUS_META[rx]
    : order
    ? ORDER_STATUS_META[order]
    : null;
  if (!meta) return null;
  const iconName = meta.icon;
  const Icon = iconName ? ((Icons as unknown as Record<string, Icons.LucideIcon>)[iconName] ?? null) : null;

  return (
    <View style={[styles.pill, { backgroundColor: meta.bg }]} accessibilityRole="text">
      {Icon ? <Icon size={13} color={meta.color} strokeWidth={2.2} /> : null}
      <Text style={[styles.text, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  text: { ...Typography.labelSm, fontWeight: '700' as const },
});
