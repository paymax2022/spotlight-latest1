import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { StockWithQuote } from '../types/invest.types';
import { formatNaira, formatPct } from '../utils/format';

/** A single stock row showing symbol, name, price and daily change. */
export default function StockRow({ stock }: { stock: StockWithQuote }) {
  const up = stock.quote.day_change_kobo >= 0;
  return (
    <Pressable
      onPress={() => router.push(`/invest/stock/${stock.symbol}`)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`${stock.name}, ${formatNaira(stock.quote.price_kobo)}`}
    >
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{stock.symbol.slice(0, 2)}</Text>
      </View>
      <View style={styles.mid}>
        <Text style={styles.symbol} numberOfLines={1}>{stock.symbol}</Text>
        <Text style={styles.name} numberOfLines={1}>{stock.name}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.price}>{formatNaira(stock.quote.price_kobo)}</Text>
        <Text style={[styles.change, { color: up ? Colors.teal : Colors.error }]}>
          {formatPct(stock.quote.day_change_pct)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  badge: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { ...Typography.labelMd, color: Colors.primary },
  mid: { flex: 1 },
  symbol: { ...Typography.labelLg, color: Colors.onSurface },
  name: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end' },
  price: { ...Typography.labelLg, color: Colors.onSurface },
  change: { ...Typography.labelSm },
});
