// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Share, StatusBar, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { castFreeVote, fetchContestantDetail, fetchRemainingFreeVotes } from '@/api/voting.api';
import { GlassCard } from '@/components/voting/GlassCard';
import { RankBadge, TrendingBadge } from '@/components/voting/Badges';
import { VoteMeter } from '@/components/voting/VoteMeter';
import { VoteButton } from '@/components/voting/VoteButton';
import { CARD_OVERLAY_GRADIENT, GLASS_BORDER, votingColors, votingRadius, votingSpacing, votingTypography } from '@/theme/voting';

export default function ContestantProfileScreen() {
  const { id, contestId: paramContestId } = useLocalSearchParams<{ id: string; contestId?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: ['contestant', id],
    queryFn: () => fetchContestantDetail(id),
  });

  const resolvedContestId = paramContestId ?? (detail.data?.contestId as string | undefined);

  const freeVotesQuery = useQuery({
    queryKey: ['freeVotesRemaining', resolvedContestId],
    queryFn: () => fetchRemainingFreeVotes(resolvedContestId!),
    enabled: !!resolvedContestId,
    staleTime: 30_000,
  });

  // null = still loading (allow); number = authoritative value from server
  const freeVotesRemaining = freeVotesQuery.data?.freeVotesRemaining ?? null;
  // Exhausted only when we have a confirmed 0 from the server
  const freeVotesExhausted = freeVotesRemaining !== null && freeVotesRemaining <= 0;

  const freeVoteMutation = useMutation({
    mutationFn: () =>
      castFreeVote({
        contestantId: id,
        contestId: resolvedContestId,
        idempotencyKey: `free-vote:${id}:${resolvedContestId}:${Date.now()}`,
      }),
    onSuccess: (result) => {
      // Write known-correct values into cache immediately so the UI updates
      // before background refetches complete.

      // 1. Decrement free votes remaining using the server response
      queryClient.setQueryData(
        ['freeVotesRemaining', resolvedContestId],
        (old: import('@/api/voting.api').RemainingFreeVotes | undefined) =>
          old
            ? {
                ...old,
                freeVotesRemaining: result.freeVotesRemaining,
                freeVotesUsed: old.freeVotesUsed + (result.votesAdded ?? 1),
              }
            : old,
      );

      // 2. Bump the contestant's vote count optimistically by votesAdded
      queryClient.setQueryData(
        ['contestant', id],
        (old: any) =>
          old
            ? {
                ...old,
                voteCount: (old.voteCount ?? 0) + (result.votesAdded ?? 1),
              }
            : old,
      );

      // Background refetches to get authoritative data from the server
      queryClient.invalidateQueries({ queryKey: ['contestant', id] });
      queryClient.invalidateQueries({ queryKey: ['contestants', resolvedContestId] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard', resolvedContestId] });
      queryClient.invalidateQueries({ queryKey: ['freeVotesRemaining', resolvedContestId] });

      const contestant = detail.data;
      router.push({
        pathname: '/contest/vote-success',
        params: {
          contestantName: contestant?.name ?? '',
          voteCount: String(result.votesAdded ?? 1),
          freeVotesRemaining: String(result.freeVotesRemaining ?? 0),
          newTotal: String((contestant?.voteCount ?? 0) + (result.votesAdded ?? 1)),
        },
      });
    },
  });

  const freeVoteButtonDisabled = freeVotesExhausted || freeVoteMutation.isPending;

  if (detail.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={votingColors.gold.DEFAULT} size="large" />
      </SafeAreaView>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base, alignItems: 'center', justifyContent: 'center', padding: votingSpacing.margin }}>
        <Text style={[votingTypography.bodyMd, { color: votingColors.error, textAlign: 'center', marginBottom: votingSpacing.md }]}>Failed to load contestant</Text>
        <VoteButton title="Retry" variant="outline" onPress={() => detail.refetch()} />
      </SafeAreaView>
    );
  }

  const c = detail.data;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Vote for ${c.name} on Spotlight! They're currently ranked #${c.rank} 🌟`,
        title: `Vote for ${c.name}`,
      });
    } catch {}
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={detail.isRefetching} onRefresh={detail.refetch} tintColor={votingColors.gold.DEFAULT} />}
      >
        {/* Hero */}
        <View style={{ height: 320, backgroundColor: votingColors.bg.elevated }}>
          {c.photoUrl && (
            <Image source={{ uri: c.photoUrl }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
          )}
          <LinearGradient colors={CARD_OVERLAY_GRADIENT} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' }} />

          {/* Nav bar */}
          <View style={{ position: 'absolute', top: votingSpacing.md, left: votingSpacing.margin, right: votingSpacing.margin, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Pressable
              onPress={() => router.back()}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: votingColors.bg.glassStrong, borderWidth: 1, borderColor: GLASS_BORDER, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="arrow-back" size={20} color={votingColors.onSurface} />
            </Pressable>
            <Pressable
              onPress={handleShare}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: votingColors.bg.glassStrong, borderWidth: 1, borderColor: GLASS_BORDER, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="share-outline" size={20} color={votingColors.onSurface} />
            </Pressable>
          </View>

          {/* Rank + category + name */}
          <View style={{ position: 'absolute', bottom: votingSpacing.lg, left: votingSpacing.margin, right: votingSpacing.margin, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <RankBadge rank={c.rank} />
              <Text style={[votingTypography.labelSm, { color: votingColors.gold.DEFAULT }]}>{c.category?.toUpperCase()}</Text>
              {c.isTopContestant && <TrendingBadge />}
            </View>
            <Text style={[votingTypography.headlineLgMobile, { color: votingColors.onSurface }]}>{c.name}</Text>
          </View>
        </View>

        <View style={{ padding: votingSpacing.margin, gap: votingSpacing.lg }}>
          {/* Vote meter */}
          <GlassCard glow={c.isTopContestant}>
            <Text style={[votingTypography.labelMd, { color: votingColors.onSurfaceMuted }]}>Current Standing</Text>
            <VoteMeter percent={c.votePercent} votes={c.voteCount} label={`${c.votePercent?.toFixed(1)}% of total votes`} />
          </GlassCard>

          {/* Highlights */}
          {c.highlights?.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {c.highlights.map((h: string) => (
                <View key={h} style={{ backgroundColor: 'rgba(242,202,80,0.12)', borderRadius: votingRadius.full, paddingHorizontal: votingSpacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: votingColors.outlineSubtle }}>
                  <Text style={[votingTypography.labelSm, { color: votingColors.gold.DEFAULT }]}>{h}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Bio */}
          {c.bio && (
            <GlassCard>
              <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>About</Text>
              <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted, lineHeight: 24 }]}>{c.bio}</Text>
            </GlassCard>
          )}

          {/* Vote CTAs */}
          <View style={{ gap: votingSpacing.sm }}>
            <VoteButton
              title={freeVotesExhausted ? 'Free Votes Used Up' : 'Cast Free Vote'}
              size="lg"
              loading={freeVoteMutation.isPending}
              disabled={freeVoteButtonDisabled}
              onPress={() => freeVoteMutation.mutate()}
            />
            {freeVotesExhausted && freeVotesQuery.data && (
              <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, textAlign: 'center' }]}>
                You've used all {freeVotesQuery.data.freeVotesPerDay} free votes today.
                Resets in {freeVotesQuery.data.nextResetHours}h — or buy votes below.
              </Text>
            )}
            {!freeVotesExhausted && freeVotesRemaining !== null && (
              <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, textAlign: 'center' }]}>
                {freeVotesRemaining} free vote{freeVotesRemaining !== 1 ? 's' : ''} remaining today
              </Text>
            )}
            <VoteButton
              title="Buy Votes for This Contestant"
              variant="outline"
              onPress={() =>
                router.push({
                  pathname: '/contest/vote-modal',
                  params: { contestantId: id, contestantName: c.name, contestId: resolvedContestId },
                })
              }
            />
          </View>

          {freeVoteMutation.isError && (
            <Text style={[votingTypography.labelSm, { color: votingColors.error, textAlign: 'center' }]}>
              {(freeVoteMutation.error as any)?.response?.data?.error ?? 'Vote failed. Please try again.'}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
