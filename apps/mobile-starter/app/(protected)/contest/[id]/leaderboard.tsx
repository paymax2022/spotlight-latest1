// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StatusBar, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchLeaderboard } from '@/api/voting.api';
import { GlassCard } from '@/components/voting/GlassCard';
import { RankBadge } from '@/components/voting/Badges';
import { VoteMeter } from '@/components/voting/VoteMeter';
import { GLASS_BORDER, GOLD_GLOW_SHADOW, votingColors, votingRadius, votingSpacing, votingTypography } from '@/theme/voting';


const CHANGE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  up: 'trending-up-outline',
  down: 'trending-down-outline',
  same: 'remove-outline',
};
const CHANGE_COLORS: Record<string, string> = {
  up: votingColors.emerald.DEFAULT,
  down: votingColors.error,
  same: votingColors.onSurfaceMuted,
};

export default function LeaderboardScreen() {
  const { id: contestId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const board = useQuery({
    queryKey: ['leaderboard', contestId],
    queryFn: () => fetchLeaderboard(contestId),
    refetchInterval: 30_000,
  });

  const entries = board.data ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: votingSpacing.md,
          paddingHorizontal: votingSpacing.margin, paddingVertical: votingSpacing.md,
          borderBottomWidth: 1, borderBottomColor: GLASS_BORDER,
        }}
      >
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={votingColors.onSurface} />
        </Pressable>
        <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface, flex: 1 }]}>Leaderboard</Text>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            backgroundColor: votingColors.indigo.container, borderRadius: 9999,
            paddingHorizontal: 10, paddingVertical: 4,
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: votingColors.onSurface }} />
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurface }]}>LIVE</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={board.isRefetching} onRefresh={board.refetch} tintColor={votingColors.gold.DEFAULT} />}
        contentContainerStyle={{ padding: votingSpacing.margin, gap: votingSpacing.md }}
      >
        {board.isLoading && (
          <View style={{ alignItems: 'center', paddingVertical: votingSpacing.xxl }}>
            <ActivityIndicator color={votingColors.gold.DEFAULT} size="large" />
          </View>
        )}

        {board.isError && !board.isLoading && (
          <Pressable onPress={() => board.refetch()} style={{ alignItems: 'center', paddingVertical: votingSpacing.lg }}>
            <Text style={[votingTypography.bodyMd, { color: votingColors.error, marginBottom: votingSpacing.sm }]}>Failed to load leaderboard</Text>
            <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>Retry</Text>
          </Pressable>
        )}

        {/* Top 3 podium */}
        {entries.length >= 3 && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: votingSpacing.sm, marginBottom: votingSpacing.sm }}>
            {/* 2nd */}
            <GlassCard style={{ flex: 1, alignItems: 'center', paddingTop: votingSpacing.xl }}>
              <RankBadge rank={2} />
              <Text style={[votingTypography.labelMd, { color: votingColors.onSurface, marginTop: 8 }]} numberOfLines={2}>
                {entries[1].contestant.name}
              </Text>
              <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
                {(entries[1].contestant.voteCount / 1000).toFixed(1)}K
              </Text>
            </GlassCard>

            {/* 1st — elevated with glow */}
            <GlassCard glow style={{ flex: 1, alignItems: 'center', paddingTop: votingSpacing.md }}>
              <Text style={{ fontSize: 28 }}>👑</Text>
              <RankBadge rank={1} />
              <Text style={[votingTypography.labelMd, { color: votingColors.onSurface, marginTop: 8 }]} numberOfLines={2}>
                {entries[0].contestant.name}
              </Text>
              <Text style={[votingTypography.labelSm, { color: votingColors.gold.DEFAULT }]}>
                {(entries[0].contestant.voteCount / 1000).toFixed(1)}K
              </Text>
            </GlassCard>

            {/* 3rd */}
            <GlassCard style={{ flex: 1, alignItems: 'center', paddingTop: votingSpacing.xl + votingSpacing.sm }}>
              <RankBadge rank={3} />
              <Text style={[votingTypography.labelMd, { color: votingColors.onSurface, marginTop: 8 }]} numberOfLines={2}>
                {entries[2].contestant.name}
              </Text>
              <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
                {(entries[2].contestant.voteCount / 1000).toFixed(1)}K
              </Text>
            </GlassCard>
          </View>
        )}

        {/* Full ranked list */}
        {entries.map((entry) => (
          <Pressable
            key={entry.contestant.id}
            onPress={() => router.push({ pathname: `/contestant/${entry.contestant.id}`, params: { contestId } })}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: votingSpacing.md,
              backgroundColor: entry.rank <= 3 ? 'rgba(242,202,80,0.06)' : votingColors.bg.card,
              borderRadius: votingRadius.lg, borderWidth: 1,
              borderColor: entry.rank === 1 ? votingColors.gold.DEFAULT : GLASS_BORDER,
              padding: votingSpacing.md,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <RankBadge rank={entry.rank} />

            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface }]} numberOfLines={1}>
                {entry.contestant.name}
              </Text>
              <VoteMeter percent={entry.contestant.votePercent} votes={entry.contestant.voteCount} />
            </View>

            <View style={{ alignItems: 'center', gap: 2 }}>
              <Ionicons
                name={CHANGE_ICONS[entry.rankChange]}
                size={14}
                color={CHANGE_COLORS[entry.rankChange]}
              />
              <Text style={[votingTypography.labelSm, { color: CHANGE_COLORS[entry.rankChange] }]}>
                {entry.rankChange === 'same' ? '—' : entry.previousRank ? `was #${entry.previousRank}` : ''}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
