import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Spacing } from '@/constants/spacing';
import FeaturedCard from './FeaturedCard';
import type { LandingItem } from '../types';

/** Two-column grid of promoted tiles. */
export default function FeaturedGrid({
  items,
  onPressItem,
}: {
  items: LandingItem[];
  onPressItem: (item: LandingItem) => void;
}) {
  // Pair items into rows of two so each row lays out evenly with a gap.
  const rows: LandingItem[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));

  return (
    <View style={s.wrap}>
      {rows.map((row, ri) => (
        <View key={ri} style={s.row}>
          {row.map((item) => (
            <FeaturedCard key={item.campaign_id} item={item} onPress={onPressItem} variant="grid" />
          ))}
          {row.length === 1 ? <View style={s.spacer} /> : null}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.md },
  spacer: { flex: 1 },
});
