import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import SectionHeader from '@/components/SectionHeader';
import { useLandingPlacements, useReportEvents } from '../hooks';
import { sessionId } from '../utils';
import type { LandingItem, LandingZone, PlacementEvent } from '../types';
import FeaturedHero from './FeaturedHero';
import FeaturedCarousel from './FeaturedCarousel';
import FeaturedGrid from './FeaturedGrid';

/**
 * Self-contained "Featured" block for the home screen — fed by the public
 * landing resolver. Fires impression events once when items become visible and
 * tap events on press, then deep-links to the promoted subject. Renders nothing
 * while loading or when there are no placements, so it is purely additive to
 * the existing home content.
 */
export default function FeaturedHomeSection() {
  const { data } = useLandingPlacements({ poll: true });
  const reportEvents = useReportEvents();
  const reportedRef = React.useRef<Set<string>>(new Set());

  const zones = data?.zones ?? [];
  const heroZone = zones.find((z) => z.layout_type === 'hero');
  const carouselZone = zones.find((z) => z.layout_type === 'carousel');
  const gridZone = zones.find((z) => z.layout_type === 'grid');

  const allItems = React.useMemo<{ item: LandingItem; zone: LandingZone }[]>(
    () => zones.flatMap((z) => z.items.map((item) => ({ item, zone: z }))),
    [zones],
  );

  // Fire one impression per (campaign, token) the first time it appears.
  React.useEffect(() => {
    const fresh: PlacementEvent[] = [];
    for (const { item } of allItems) {
      const dedupe = `${item.campaign_id}:${item.placement_token}`;
      if (reportedRef.current.has(dedupe)) continue;
      reportedRef.current.add(dedupe);
      fresh.push({
        campaign_id: item.campaign_id,
        type: 'impression',
        placement_token: item.placement_token,
        session_id: sessionId(),
      });
    }
    if (fresh.length) reportEvents.mutate(fresh);
    // reportEvents is stable from react-query; depend only on the item set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems]);

  const handlePress = React.useCallback(
    (item: LandingItem) => {
      reportEvents.mutate([
        {
          campaign_id: item.campaign_id,
          type: 'tap',
          placement_token: item.placement_token,
          session_id: sessionId(),
        },
      ]);
      try {
        router.push(item.creative.deep_link as never);
      } catch {
        /* unresolved deep link — ignore */
      }
    },
    [reportEvents],
  );

  const hasAny =
    (heroZone?.items.length ?? 0) > 0 ||
    (carouselZone?.items.length ?? 0) > 0 ||
    (gridZone?.items.length ?? 0) > 0;
  if (!hasAny) return null;

  return (
    <View style={s.wrap}>
      <SectionHeader title="Featured" style={{ marginTop: Spacing.lg }} />
      <Text style={s.disclosure}>Sponsored placements</Text>

      {heroZone?.items[0] ? (
        <FeaturedHero item={heroZone.items[0]} onPress={handlePress} />
      ) : null}

      {carouselZone && carouselZone.items.length > 0 ? (
        <View style={s.block}>
          <FeaturedCarousel items={carouselZone.items} onPressItem={handlePress} />
        </View>
      ) : null}

      {gridZone && gridZone.items.length > 0 ? (
        <View style={s.block}>
          <FeaturedGrid items={gridZone.items} onPressItem={handlePress} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: Spacing.sm },
  disclosure: {
    ...Typography.caption,
    color: Colors.onSurfaceVariant,
    paddingHorizontal: Spacing.containerMargin,
    marginTop: -Spacing.xs,
    marginBottom: Spacing.sm,
  },
  block: { marginBottom: Spacing.md },
});
