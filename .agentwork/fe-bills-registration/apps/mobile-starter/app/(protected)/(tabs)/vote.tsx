// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, StatusBar, Text, TextInput, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import { fetchContests, fetchCategories } from '@/api/voting.api';
import { ContestCard } from '@/components/voting/ContestCard';
import { GlassCard } from '@/components/voting/GlassCard';
import { LiveBadge } from '@/components/voting/Badges';
import { GLASS_BORDER, votingColors, votingSpacing, votingTypography } from '@/theme/voting';

export default function VoteHomeScreen() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');

  const categoriesQuery = useQuery({
    queryKey: ['contestCategories'],
    queryFn: fetchCategories,
    staleTime: 5 * 60_000,
  });

  const contests = useQuery({
    queryKey: ['contests', activeCategory, search],
    queryFn: () => fetchContests({ category: activeCategory === 'all' ? undefined : activeCategory, search: search || undefined }),
    staleTime: 30_000,
  });

  const categories = categoriesQuery.data ?? [{ id: 'all', name: 'All', activeContestCount: 0 }];
  const contestList = contests.data ?? [];
  const filtered = contestList.filter((c) =>
    search ? c.title.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" backgroundColor={votingColors.bg.base} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={contests.isRefetching}
            onRefresh={() => {
              contests.refetch();
              categoriesQuery.refetch();
            }}
            tintColor={votingColors.gold.DEFAULT}
          />
        }
        contentContainerStyle={{ paddingBottom: votingSpacing.xxl }}
      >
        {/* Header */}
        <View style={{ padding: votingSpacing.margin, paddingBottom: 0, gap: 4 }}>
          <Text style={[votingTypography.labelSm, { color: votingColors.gold.DEFAULT, letterSpacing: 2 }]}>
            SPOTLIGHT
          </Text>
          <Text style={[votingTypography.headlineLgMobile, { color: votingColors.onSurface }]}>
            Live Contests
          </Text>
        </View>

        {/* Search bar */}
        <View style={{ paddingHorizontal: votingSpacing.margin, paddingTop: votingSpacing.md }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: votingSpacing.sm,
              backgroundColor: votingColors.bg.card, borderRadius: 12,
              borderWidth: 1, borderColor: search ? votingColors.indigo.DEFAULT : GLASS_BORDER,
              paddingHorizontal: votingSpacing.md, height: 48,
            }}
          >
            <Ionicons name="search-outline" size={18} color={votingColors.onSurfaceMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search contests..."
              placeholderTextColor={votingColors.onSurfaceMuted}
              style={[votingTypography.bodyMd, { flex: 1, color: votingColors.onSurface }]}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color={votingColors.onSurfaceMuted} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Category chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: votingSpacing.margin, paddingTop: votingSpacing.md, gap: 8 }}
        >
          {categories.map((cat) => {
            const active = activeCategory === cat.id;
            return (
              <Pressable
                key={cat.id}
                onPress={() => setActiveCategory(cat.id)}
                style={{
                  paddingHorizontal: votingSpacing.md, paddingVertical: 8, borderRadius: 9999,
                  backgroundColor: active ? votingColors.gold.container : votingColors.bg.card,
                  borderWidth: 1, borderColor: active ? votingColors.gold.DEFAULT : GLASS_BORDER,
                }}
              >
                <Text style={[votingTypography.labelMd, { color: active ? votingColors.gold.on : votingColors.onSurface }]}>
                  {cat.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Loading */}
        {contests.isLoading && (
          <View style={{ padding: votingSpacing.xxl, alignItems: 'center' }}>
            <ActivityIndicator color={votingColors.gold.DEFAULT} size="large" />
          </View>
        )}

        {/* Error */}
        {contests.isError && !contests.isLoading && (
          <View style={{ paddingHorizontal: votingSpacing.margin, marginTop: votingSpacing.lg }}>
            <GlassCard>
              <Text style={[votingTypography.bodyMd, { color: votingColors.error, textAlign: 'center' }]}>
                Failed to load contests
              </Text>
              <Pressable onPress={() => contests.refetch()} style={{ marginTop: votingSpacing.sm, alignItems: 'center' }}>
                <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>Retry</Text>
              </Pressable>
            </GlassCard>
          </View>
        )}

        {/* Live now banner */}
        {!contests.isLoading && filtered.length > 0 && (
          <View style={{ marginHorizontal: votingSpacing.margin, marginTop: votingSpacing.lg, flexDirection: 'row', alignItems: 'center', gap: votingSpacing.sm }}>
            <LiveBadge />
            <Text style={[votingTypography.labelMd, { color: votingColors.onSurface }]}>
              {filtered.filter((c) => c.isLive).length} contests live right now
            </Text>
          </View>
        )}

        {/* Contest cards */}
        {!contests.isLoading && (
          <View style={{ paddingHorizontal: votingSpacing.margin, marginTop: votingSpacing.md, gap: votingSpacing.md }}>
            {filtered.length === 0 && !contests.isError ? (
              <GlassCard>
                <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted, textAlign: 'center' }]}>
                  No contests found
                </Text>
              </GlassCard>
            ) : (
              filtered.map((contest) => (
                <ContestCard
                  key={contest.id}
                  contest={contest as any}
                  onPress={() => router.push(`/contest/${contest.id}`)}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
