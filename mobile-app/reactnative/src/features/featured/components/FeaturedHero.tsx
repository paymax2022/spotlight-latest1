import React from 'react';
import PromoBanner from '@/components/PromoBanner';
import type { LandingItem } from '../types';

/**
 * Hero placement on the home screen. Reuses the shared PromoBanner gradient card
 * and is always badged "FEATURED" so the promotion is clearly disclosed.
 */
export default function FeaturedHero({
  item,
  onPress,
}: {
  item: LandingItem;
  onPress: (item: LandingItem) => void;
}) {
  return (
    <PromoBanner
      title={item.creative.headline}
      subtitle={item.label}
      cta={item.creative.cta || 'View'}
      badge="FEATURED"
      onPress={() => onPress(item)}
    />
  );
}
