import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import type { LandingItem } from '../types';

/**
 * Promoted item card used by the carousel and grid. Always carries a visible
 * "Promoted" tag so sponsored content is clearly disclosed to consumers.
 */
export default function FeaturedCard({
  item,
  onPress,
  variant = 'carousel',
}: {
  item: LandingItem;
  onPress: (item: LandingItem) => void;
  variant?: 'carousel' | 'grid';
}) {
  const isGrid = variant === 'grid';
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        s.card,
        isGrid ? s.gridCard : s.carouselCard,
        shadow1,
        pressed && { opacity: 0.92 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Promoted: ${item.creative.headline}`}
    >
      <View style={[s.imageWrap, isGrid ? s.gridImage : s.carouselImage]}>
        {item.creative.image_ref ? (
          <Image source={{ uri: item.creative.image_ref }} style={s.image} resizeMode="cover" />
        ) : (
          <View style={[s.image, s.imageFallback]} />
        )}
        <View style={s.tag}>
          <Text style={s.tagText}>Promoted</Text>
        </View>
      </View>
      <View style={s.body}>
        <Text style={s.headline} numberOfLines={2}>
          {item.creative.headline}
        </Text>
        <Text style={s.label} numberOfLines={1}>
          {item.label}
        </Text>
        <Text style={s.cta} numberOfLines={1}>
          {item.creative.cta || 'View'} →
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  carouselCard: { width: 240, marginRight: Spacing.md },
  gridCard: { flex: 1 },
  imageWrap: { position: 'relative', backgroundColor: Colors.surfaceContainer },
  carouselImage: { height: 130 },
  gridImage: { height: 100 },
  image: { width: '100%', height: '100%' },
  imageFallback: { backgroundColor: Colors.surfaceContainerHigh },
  tag: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    backgroundColor: 'rgba(11,28,48,0.72)',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  tagText: { ...Typography.caption, color: Colors.white, fontWeight: '700' as const },
  body: { padding: Spacing.md, gap: 2 },
  headline: { ...Typography.labelLg, color: Colors.onSurface },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  cta: { ...Typography.labelSm, color: Colors.secondary, marginTop: 4 },
});
