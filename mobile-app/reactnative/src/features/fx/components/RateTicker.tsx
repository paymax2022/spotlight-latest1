import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { TrendingUp, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatPct } from '../utils/fxFormatters';
import type { IndicativeRate } from '../types/fx.types';

interface Props {
  rates: IndicativeRate[];
  onPressRate?: (rate: IndicativeRate) => void;
}

/** Horizontal live-rate ticker (Home → Live rate ticker). */
export default function RateTicker({ rates, onPressRate }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Live exchange rates"
    >
      {rates.map((r) => {
        const up = r.change24hPct >= 0;
        return (
          <Pressable
            key={r.pair}
            onPress={() => onPressRate?.(r)}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${r.from} to ${r.to}, ${r.sell}, ${formatPct(r.change24hPct)} today`}
          >
            <Text style={styles.pair}>{r.from}/{r.to}</Text>
            <Text style={styles.rate}>{r.sell.toLocaleString('en-NG', { maximumFractionDigits: 2 })}</Text>
            <View style={styles.changeRow}>
              {up
                ? <TrendingUp size={12} color={Colors.teal} strokeWidth={2} />
                : <TrendingDown size={12} color={Colors.error} strokeWidth={2} />}
              <Text style={[styles.change, { color: up ? Colors.teal : Colors.error }]}>
                {formatPct(r.change24hPct)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  chip: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minWidth: 104,
  },
  pressed: { opacity: 0.8 },
  pair: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rate: { ...Typography.titleMd, color: Colors.onSurface, marginVertical: 2 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  change: { ...Typography.caption, fontWeight: '600' as const },
});
