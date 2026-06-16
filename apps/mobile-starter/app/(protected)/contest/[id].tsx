// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image, Pressable, RefreshControl, ScrollView, StatusBar, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchContestDetail } from '@/api/voting.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { GlassCard } from '@/components/voting/GlassCard';
import { LiveBadge } from '@/components/voting/Badges';
import { VoteButton } from '@/components/voting/VoteButton';
import { CARD_OVERLAY_GRADIENT, GLASS_BORDER, votingColors, votingRadius, votingSpacing, votingTypography } from '@/theme/voting';

export default function ContestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const detail = useQuery({
    queryKey: ['contest', id],
    queryFn: () => fetchContestDetail(id),
  });

  if (detail.isLoading) return <AppLoader />;

  if (detail.isError || !detail.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base, alignItems: 'center', justifyContent: 'center', padding: votingSpacing.margin }}>
        <Text style={[votingTypography.bodyMd, { color: votingColors.error, textAlign: 'center', marginBottom: votingSpacing.md }]}>Failed to load contest</Text>
        <VoteButton title="Retry" variant="outline" onPress={() => detail.refetch()} />
      </SafeAreaView>
    );
  }

  const contest = detail.data;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={detail.isRefetching} onRefresh={detail.refetch} tintColor={votingColors.gold.DEFAULT} />}
      >
        {/* Hero cover */}
        <View style={{ height: 280, backgroundColor: votingColors.bg.elevated }}>
          {contest.coverUrl && (
            <Image source={{ uri: contest.coverUrl }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
          )}
          <LinearGradient colors={CARD_OVERLAY_GRADIENT} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' }} />

          {/* Back button */}
          <Pressable
            onPress={() => router.back()}
            style={{
              position: 'absolute', top: votingSpacing.md, left: votingSpacing.margin,
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: votingColors.bg.glassStrong,
              borderWidth: 1, borderColor: GLASS_BORDER,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name="arrow-back" size={20} color={votingColors.onSurface} />
          </Pressable>

          {/* Live badge + category */}
          <View style={{ position: 'absolute', bottom: votingSpacing.lg, left: votingSpacing.margin, right: votingSpacing.margin, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {contest.isLive && <LiveBadge />}
              <Text style={[votingTypography.labelSm, { color: votingColors.gold.DEFAULT }]}>{contest.category?.toUpperCase()}</Text>
            </View>
            <Text style={[votingTypography.headlineLgMobile, { color: votingColors.onSurface }]}>{contest.title}</Text>
          </View>
        </View>

        <View style={{ padding: votingSpacing.margin, gap: votingSpacing.lg }}>
          {/* Stats row */}
          <View style={{ flexDirection: 'row', gap: votingSpacing.md }}>
            {[
              { label: 'Contestants', value: contest.contestantCount?.toString() ?? '—' },
              { label: 'Votes Cast', value: (contest.totalVotes ?? 0).toLocaleString() },
              { label: 'Prize Pool', value: contest.prizePool ?? '—' },
            ].map((stat) => (
              <GlassCard key={stat.label} style={{ flex: 1 }} padding={votingSpacing.sm}>
                <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, textAlign: 'center' }]}>{stat.label}</Text>
                <Text style={[votingTypography.headlineSm, { color: votingColors.gold.DEFAULT, textAlign: 'center' }]}>{stat.value}</Text>
              </GlassCard>
            ))}
          </View>

          {/* Description */}
          {contest.description && (
            <GlassCard>
              <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>About</Text>
              <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted, lineHeight: 24 }]}>
                {contest.description}
              </Text>
            </GlassCard>
          )}

          {/* Free votes remaining */}
          {(contest.freeVotesRemaining ?? 0) > 0 && (
            <GlassCard glow>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>Free Votes Today</Text>
                  <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface }]}>
                    {contest.freeVotesRemaining} remaining
                  </Text>
                </View>
                <Ionicons name="star" size={28} color={votingColors.gold.DEFAULT} />
              </View>
            </GlassCard>
          )}

          {/* CTAs */}
          <View style={{ gap: votingSpacing.sm }}>
            <VoteButton
              title="View Contestants & Vote"
              size="lg"
              onPress={() => router.push(`/contest/${id}/contestants`)}
            />
            <View style={{ flexDirection: 'row', gap: votingSpacing.sm }}>
              <VoteButton
                title="Leaderboard"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => router.push(`/contest/${id}/leaderboard`)}
              />
              <VoteButton
                title="Buy Votes"
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => router.push({ pathname: '/contest/buy-votes', params: { contestId: id } })}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
