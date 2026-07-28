import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OrderStatusBadge from './OrderStatusBadge';
import { formatMoneyObj, formatShares, relativeTime } from '../utils/stockFormatters';
import { SIDE_LABEL } from '../constants/stocks.constants';
import type { StockOrder } from '../types/stocks.types';

interface Props {
  order: StockOrder;
  onPress?: () => void;
}

/** Order-history row: side + symbol · qty/time · total · status badge. */
export default function OrderRow({ order, onPress }: Props) {
  const isBuy = order.side === 'buy';
  const Icon = isBuy ? ArrowDownLeft : ArrowUpRight;
  const sign = isBuy ? '−' : '+';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${SIDE_LABEL[order.side]} ${order.symbol}, ${formatMoneyObj(order.total)}, ${order.status}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.iconBox}>
        <Icon size={18} color={Colors.primary} strokeWidth={2} />
      </View>

      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={1}>{SIDE_LABEL[order.side]} {order.symbol}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {formatShares(order.quantity)} · {relativeTime(order.createdAt)}
        </Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.amount} numberOfLines={1}>{sign}{formatMoneyObj(order.total)}</Text>
        <OrderStatusBadge status={order.status} size="sm" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  mid: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
});
