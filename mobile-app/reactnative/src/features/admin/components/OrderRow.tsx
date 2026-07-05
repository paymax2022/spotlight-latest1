// ── Paymax · Admin — OrderRow ────────────────────────────────────────────────
// One order: ref + user, side/symbol, amount, status pill, provider ref + time.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import StatusPill from './StatusPill';
import { ORDER_STATUS_STYLE, formatMoneyObj, relativeTime } from '../constants/admin.constants';
import type { AdminOrder } from '../types/admin.types';

interface Props {
  order: AdminOrder;
  onPress?: () => void;
  last?: boolean;
}

export default function OrderRow({ order, onPress, last }: Props) {
  const body = (
    <View style={[styles.row, !last && styles.border]}>
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={1}>
          {order.side === 'buy' ? 'Buy' : 'Sell'} {order.symbol}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {order.user} · {order.ref}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {order.providerRef} · {relativeTime(order.createdAt)}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.amount} numberOfLines={1}>{formatMoneyObj(order.amount)}</Text>
        <StatusPill status={order.status} styleMap={ORDER_STATUS_STYLE} />
      </View>
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>{body}</Pressable>;
  }
  return body;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.cardPadding,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.outlineVariant },
  pressed: { opacity: 0.6 },
  left: { flex: 1, gap: 2 },
  title: { ...Typography.bodyMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Typography.labelMd, color: Colors.onSurface },
});
