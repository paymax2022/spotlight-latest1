// @ts-nocheck
/**
 * Music Contests Category screen.
 * Stitch screen: "Music Contests Category" (19772dba3e024752974fd3f6a7197ce1)
 * Shows contests filtered by category with sub-genre chips and status filters.
 */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StatusBar, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import { fetchContests } from '@/api/voting.api';
import { ContestCard } from '@/components/voting/ContestCard';
import { LiveBadge } from '@/components/voting/Badges';
import { GLASS_BORDER, votingColors, votingRadius, votingSpacing, votingTypography } from '@/theme/voting';

const STATUS_FILTERS = ['Voting', 'Live', 'Trending'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

export default function ContestCategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [activeGenre, setActiveGenre] = useState('All');
  const [activeStatus, setActiveStatus] = useState<StatusFilter | null>(null);

  const label = slug
    ? `${slug.charAt(0).toUpperCase()}${slug.slice(1)} Contests`
    : 'Contests';

  const contests = useQuery({
    queryKey: ['contests', slug],
    queryFn: () => fetchContests({ category: slug }),
  });

  const allContests = contests.data ?? [];

  // Derive genre chips from fetched data
  const genres = ['All', ...Array.from(new Set(allContests.map((c) => c.category).filter(Boolean)))];

  const data = allContests.filter((c) => {
    if (activeGenre !== 'All' && c.category !== activeGenre) return false;
    if (activeStatus === 'Live' && !c.isLive) return false;
    if (activeStatus === 'Trending' && !c.isTrending) return false;
    if (activeStatus === 'Voting' && !c.isLive) return false;
    return true;
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: votingSpacing.md, paddingHorizontal: votingSpacing.margin, paddingVertical: votingSpacing.sm, borderBottomWidth: 1, borderBottomColor: GLASS_BORDER }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="arrow-back" size={22} color={votingColors.onSurface} />
        </Pressable>
        <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface, flex: 1 }]}>{label}</Text>
        <LiveBadge />
      </View>

      {/* Genre filter chips */}
      <View style={{ paddingVertical: votingSpacing.sm }}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={genres}
          keyExtractor={(g) => g}
          contentContainerStyle={{ paddingHorizontal: votingSpacing.margin, gap: votingSpacing.sm }}
          renderItem={({ item: genre }) => {
            const active = genre === activeGenre;
            return (
              <Pressable
                onPress={() => setActiveGenre(genre)}
                style={{
                  paddingHorizontal: votingSpacing.md,
                  paddingVertical: 7,
                  borderRadius: votingRadius.full,
                  backgroundColor: active ? votingColors.gold.DEFAULT : votingColors.bg.card,
                  borderWidth: 1,
                  borderColor: active ? votingColors.gold.DEFAULT : GLASS_BORDER,
                }}
              >
                <Text style={[votingTypography.labelSm, { color: active ? votingColors.gold.on : votingColors.onSurface }]}>
                  {genre}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {/* Status filter row */}
      <View style={{ flexDirection: 'row', gap: votingSpacing.sm, paddingHorizontal: votingSpacing.margin, paddingBottom: votingSpacing.sm }}>
        {STATUS_FILTERS.map((status) => {
          const active = activeStatus === status;
          const iconName = status === 'Voting' ? 'radio' : status === 'Live' ? 'wifi' : 'trending-up';
          const color = status === 'Trending' ? votingColors.gold.DEFAULT : votingColors.indigo.DEFAULT;
          return (
            <Pressable
              key={status}
              onPress={() => setActiveStatus(active ? null : status)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: votingSpacing.sm, paddingVertical: 5,
                borderRadius: votingRadius.full,
                backgroundColor: active ? (status === 'Trending' ? 'rgba(242,202,80,0.15)' : 'rgba(192,193,255,0.15)') : votingColors.bg.card,
                borderWidth: 1,
                borderColor: active ? color : GLASS_BORDER,
              }}
            >
              <Ionicons name={iconName as any} size={12} color={active ? color : votingColors.onSurfaceMuted} />
              <Text style={[votingTypography.labelSm, { color: active ? color : votingColors.onSurfaceMuted }]}>{status}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Contest list */}
      {contests.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={votingColors.gold.DEFAULT} size="large" />
        </View>
      ) : contests.isError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: votingSpacing.md }}>
          <Text style={[votingTypography.bodyMd, { color: votingColors.error }]}>Failed to load contests</Text>
          <Pressable onPress={() => contests.refetch()}>
            <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>Retry</Text>
          </Pressable>
        </View>
      ) : data.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: votingSpacing.md }}>
          <Ionicons name="search-outline" size={48} color={votingColors.onSurfaceMuted} />
          <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted }]}>No contests match your filters</Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: votingSpacing.margin, gap: votingSpacing.md }}
          refreshing={contests.isRefetching}
          onRefresh={contests.refetch}
          renderItem={({ item: contest }) => (
            <ContestCard
              contest={contest}
              onPress={() => router.push({ pathname: '/contest/[id]', params: { id: contest.id } })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
