import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { Spacing } from '@/constants/spacing';
import FeaturedCard from './FeaturedCard';
import type { LandingItem } from '../types';

/** Horizontal carousel of promoted cards. */
export default function FeaturedCarousel({
  items,
  onPressItem,
}: {
  items: LandingItem[];
  onPressItem: (item: LandingItem) => void;
}) {
  return (
    <FlatList
      data={items}
      horizontal
      keyExtractor={(it) => it.campaign_id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.content}
      renderItem={({ item }) => (
        <FeaturedCard item={item} onPress={onPressItem} variant="carousel" />
      )}
    />
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xs },
});
