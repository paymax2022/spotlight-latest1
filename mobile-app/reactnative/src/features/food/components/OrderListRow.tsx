import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import FoodStatusBadge from './FoodStatusBadge';
import { formatNaira, relativeTime } from '../utils';
import type { Order } from '../types';

/** Shared order summary row used by the customer / restaurant / rider lists. */
export default function OrderListRow({ order, onPress }: { order: Order; onPress: () => void }) {
  const itemCount = order.items.reduce((n, it) => n + it.qty, 0);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, shadow1, pressed && { opacity: 0.9 }]} accessibilityRole="button">
      <View style={s.body}>
        <View style={s.topRow}>
          <Text style={s.name} numberOfLines={1}>
            {order.restaurantName}
          </Text>
          <Text style={s.total}>{formatNaira(order.totalKobo)}</Text>
        </View>
        <Text style={s.meta} numberOfLines={1}>
          {itemCount} item{itemCount > 1 ? 's' : ''} · {order.deliveryAddress}
        </Text>
        <View style={s.bottomRow}>
          <FoodStatusBadge status={order.status} />
          <View style={s.timeRow}>
            <Clock size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={s.time}>{relativeTime(order.createdAt)}</Text>
          </View>
        </View>
      </View>
      <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  body: { flex: 1, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  total: { ...Typography.labelMd, color: Colors.primary },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  time: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
