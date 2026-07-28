import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

interface Props {
  symbol: string;
  color: string;          // ticker brand color (server-config, not a design token)
  size?: number;
}

/**
 * Soft-tinted square glyph tile for a stock ticker (DESIGN-Mobile.md → Icon
 * Enclosures: 12px rounded square with a low-opacity tint of the icon's color).
 * Shows the first 1–2 letters of the ticker. The color comes from the (admin-set)
 * asset payload, so it isn't a hard-coded brand token.
 */
export default function StockIcon({ symbol, color, size = 42 }: Props) {
  const glyph = symbol.slice(0, 2).toUpperCase();
  return (
    <View
      style={[
        styles.box,
        { width: size, height: size, borderRadius: Radius.md, backgroundColor: `${color}1F` },
      ]}
    >
      <Text style={[styles.glyph, { color, fontSize: size * 0.32 }]}>{glyph}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  glyph: { ...Typography.labelLg, fontWeight: '800' as const },
});
