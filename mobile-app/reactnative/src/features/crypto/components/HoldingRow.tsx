import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import AssetIcon from './AssetIcon';
import PriceChange from './PriceChange';
import { formatCrypto, formatFiatObj } from '../utils/cryptoFormatters';
import { useAssets } from '../hooks/useCrypto';
import type { Position } from '../types/crypto.types';

interface Props {
  position: Position;
  onPress?: () => void;
}

/** Portfolio holding row: glyph · name/qty · market value · unrealized P/L %. */
export default function HoldingRow({ position, onPress }: Props) {
  // Asset decimals drive crypto formatting; fall back to a sensible default.
  const { data: assets } = useAssets();
  const decimals = assets?.find((a) => a.id === position.assetId)?.decimals ?? 8;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${position.name} holding, ${formatFiatObj(position.marketValue)}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <AssetIcon symbol={position.symbol} color={position.iconColor} />
      <View style={styles.mid}>
        <Text style={styles.name} numberOfLines={1}>{position.name}</Text>
        <Text style={styles.qty} numberOfLines={1}>
          {formatCrypto(position.quantity.amount, position.symbol, decimals)}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.value} numberOfLines={1}>{formatFiatObj(position.marketValue)}</Text>
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
