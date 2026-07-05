import React, { useMemo } from 'react';
import { View, Text, Image, SectionList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPinned, MapPin, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useNearby } from '@/features/connect/discovery/hooks';
import DiscoveryVerifiedBadges from '@/features/connect/components/discovery-VerifiedBadges';
import type { DiscoveryProfile, DistanceBucket } from '@/features/connect/discovery/types';

/**
 * Nearby people (PRD §10.2 DC-04). SAFETY §3: the backend NEVER returns raw
 * coordinates — only a coarse `distanceBucket` (+ approximate `distanceLabel`).
 * So we render a bucketed list grouped by proximity band instead of plotting a
 * precise pin on a map. A precise location can never be reconstructed here.
 */

// Buckets ordered nearest → farthest, with human copy for the section header.
const BUCKET_ORDER: DistanceBucket[] = ['here', 'near', 'city', 'far'];

const BUCKET_META: Record<DistanceBucket, { title: string; subtitle: string }> = {
  here: { title: 'Right here', subtitle: 'In your immediate area' },
  near: { title: 'Nearby', subtitle: 'A short trip away' },
  city: { title: 'Around the city', subtitle: 'Within your city' },
  far: { title: 'Further out', subtitle: 'Worth the distance' },
};

// Anything without a bucket falls back to the widest band so it still shows.
function bucketOf(p: DiscoveryProfile): DistanceBucket {
  return p.distanceBucket ?? 'far';
}

interface Section {
  bucket: DistanceBucket;
  title: string;
  subtitle: string;
  data: DiscoveryProfile[];
}

export default function MapNearbyScreen() {
  const nearbyQuery = useNearby('date');
  const profiles = nearbyQuery.data ?? [];

  const sections = useMemo<Section[]>(() => {
    const byBucket = new Map<DistanceBucket, DiscoveryProfile[]>();
    for (const p of profiles) {
      const b = bucketOf(p);
      const arr = byBucket.get(b) ?? [];
      arr.push(p);
      byBucket.set(b, arr);
    }
    return BUCKET_ORDER.filter((b) => byBucket.has(b)).map((b) => ({
      bucket: b,
      title: BUCKET_META[b].title,
      subtitle: BUCKET_META[b].subtitle,
      data: byBucket.get(b) ?? [],
    }));
  }, [profiles]);

  function renderItem({ item }: { item: DiscoveryProfile }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${item.displayName}`}
        onPress={() =>
          router.push({ pathname: '/connect/discover/profile-detail', params: { id: item.id } })
        }
        style={styles.row}
      >
        <Image source={{ uri: item.photos[0] }} style={styles.avatar} resizeMode="cover" />
        <View style={styles.rowBody}>
          <Text style={styles.name}>
            {item.displayName}, {item.age}
          </Text>
          <View style={styles.distanceRow}>
            <MapPin size={13} color={ConnectColors.muted} strokeWidth={2} />
            <Text style={styles.distance}>{item.distanceLabel}</Text>
          </View>
          <DiscoveryVerifiedBadges flags={item.verified} size="sm" />
        </View>
        <ChevronRight size={20} color={ConnectColors.muted} strokeWidth={2} />
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScreenHeader title="Nearby" />

      {nearbyQuery.isLoading ? (
        <StateView kind="loading" message="Finding people nearby…" />
      ) : nearbyQuery.isError ? (
        <StateView
          kind="error"
          title="Couldn't load nearby"
          message="Please try again."
          icon="CloudOff"
          actionLabel="Retry"
          onAction={() => nearbyQuery.refetch()}
        />
      ) : profiles.length === 0 ? (
        <StateView
          kind="empty"
          title="Nobody nearby yet"
          message="Try again later or widen your filters."
          icon="MapPinned"
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.areaCard}>
              <View style={styles.areaIcon}>
                <MapPinned size={26} color={ConnectColors.brand} strokeWidth={2} />
              </View>
              <View style={styles.areaBody}>
                <Text style={styles.areaTitle}>Approximate distance only</Text>
                <Text style={styles.areaCopy}>
                  People are grouped by rough distance to protect everyone&apos;s privacy — exact
                  locations are never shown.
                </Text>
              </View>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: Spacing.containerMargin, gap: Spacing.sm },
  areaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.iconBgPurple,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  areaIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
  },
  areaBody: { flex: 1, gap: 2 },
  areaTitle: { ...Typography.titleMd, color: Colors.onSurface },
  areaCopy: { ...Typography.bodySm, color: ConnectColors.muted },
  sectionHeader: { paddingTop: Spacing.md, paddingBottom: Spacing.xs, gap: 2 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionSubtitle: { ...Typography.labelSm, color: ConnectColors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerHigh,
  },
  rowBody: { flex: 1, gap: 4 },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distance: { ...Typography.labelSm, color: ConnectColors.muted },
});
