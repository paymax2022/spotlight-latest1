import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import AssetIcon from './AssetIcon';
import PriceChange from './PriceChange';
import { formatFiatObj } from '../utils/cryptoFormatters';
import type { CryptoAsset } from '../types/crypto.types';

interface Props {
  asset: CryptoAsset;
  onPress?: () => void;
}

/** Discovery/list row: glyph · name/symbol · price · 24h change (docs → asset list). */
export default function AssetRow({ asset, onPress }: Props) {
  const paused = asset.status !== 'active' || !asset.buyEnabled;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${asset.name}, ${formatFiatObj(asset.price)}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <AssetIcon symbol={asset.symbol} color={asset.iconColor} />
      <View style={styles.mid}>
        <Text style={styles.name} numberOfLines={1}>{asset.name}</Text>
        <Text style={styles.symbol}>{asset.symbol}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.price} numberOfLines={1}>{formatFiatObj(asset.price)}</Text>
        {paused
          ? <Text style={styles.paused}>Paused</Text>
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
  symbol: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 3 },
  price: { ...Typography.labelLg, color: Colors.onSurface },
  paused: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
