import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import StockIcon from './StockIcon';
import PriceChange from './PriceChange';
import { formatMoneyObj } from '../utils/stockFormatters';
import { EXCHANGE_LABEL } from '../constants/stocks.constants';
import type { StockAsset } from '../types/stocks.types';

interface Props {
  asset: StockAsset;
  onPress?: () => void;
}

/** Discovery/list row: glyph · name/ticker+exchange · price · change/market-closed. */
export default function StockRow({ asset, onPress }: Props) {
  const paused = asset.status !== 'active' || !asset.buyEnabled;
  const closed = asset.marketStatus === 'closed';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${asset.name}, ${formatMoneyObj(asset.price)}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <StockIcon symbol={asset.symbol} color={asset.iconColor} />
      <View style={styles.mid}>
        <Text style={styles.name} numberOfLines={1}>{asset.name}</Text>
        <Text style={styles.sub} numberOfLines={1}>{asset.symbol} · {EXCHANGE_LABEL[asset.exchange]}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.price} numberOfLines={1}>{formatMoneyObj(asset.price)}</Text>
        {paused
          ? <Text style={styles.muted}>Paused</Text>
          : closed
            ? <Text style={styles.muted}>Closed</Text>
            : <PriceChange pct={asset.change24hPct} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  mid: { flex: 1 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 3 },
  price: { ...Typography.labelLg, color: Colors.onSurface },
  muted: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
