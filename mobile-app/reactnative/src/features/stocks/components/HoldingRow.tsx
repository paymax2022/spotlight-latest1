import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import StockIcon from './StockIcon';
import PriceChange from './PriceChange';
import { formatMoneyObj, formatShares } from '../utils/stockFormatters';
import type { StockPosition } from '../types/stocks.types';

interface Props {
  position: StockPosition;
  onPress?: () => void;
}

/** Portfolio holding row: glyph · name/qty · market value · unrealized P/L %. */
export default function HoldingRow({ position, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${position.name} holding, ${formatMoneyObj(position.marketValue)}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <StockIcon symbol={position.symbol} color={position.iconColor} />
      <View style={styles.mid}>
        <Text style={styles.name} numberOfLines={1}>{position.name}</Text>
        <Text style={styles.qty} numberOfLines={1}>{formatShares(position.quantity)}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.value} numberOfLines={1}>{formatMoneyObj(position.marketValue)}</Text>
        <PriceChange pct={position.unrealizedPct} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  mid: { flex: 1 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  qty: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 3 },
  value: { ...Typography.labelLg, color: Colors.onSurface },
});
