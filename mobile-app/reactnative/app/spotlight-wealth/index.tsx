import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import RewardWalletCard from '@/features/spotlightwealth/components/RewardWalletCard';
import VideoCard from '@/features/spotlightwealth/components/VideoCard';
import ChallengeCard from '@/features/spotlightwealth/components/ChallengeCard';
import LeaderboardRow from '@/features/spotlightwealth/components/LeaderboardRow';
import CampaignCard from '@/features/spotlightwealth/components/CampaignCard';
import CreatorDisclaimer from '@/features/spotlightwealth/components/CreatorDisclaimer';
import {
  useRewardWallet, useVideos, useChallenges, useLeaderboard, useCampaigns,
} from '@/features/spotlightwealth/hooks/useSpotlight';
import { WEALTH_TAGLINE } from '@/features/spotlightwealth/constants/spotlight.constants';

export default function SpotlightWealthHomeScreen() {
  const wallet = useRewardWallet();
  const videos = useVideos();
  const challenges = useChallenges();
  const leaderboard = useLeaderboard();
  const campaigns = useCampaigns();

  const featuredVideos = (videos.data ?? []).slice(0, 6);
  const activeChallenges = (challenges.data ?? []).slice(0, 3);
  const topLearners = (leaderboard.data ?? []).slice(0, 3);
  const featuredCampaigns = campaigns.data ?? [];

  const refreshing =
    wallet.isRefetching || videos.isRefetching || challenges.isRefetching ||
    leaderboard.isRefetching || campaigns.isRefetching;
  const onRefresh = () => {
    wallet.refetch(); videos.refetch(); challenges.refetch();
    leaderboard.refetch(); campaigns.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Spotlight Wealth" subtitle={WEALTH_TAGLINE} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {wallet.isLoading ? (
          <StateView kind="loading" message="Loading Spotlight Wealth…" />
        ) : wallet.isError ? (
          <StateView kind="error" title="Couldn't load Spotlight Wealth" message="Please check your connection and try again." actionLabel="Retry" onAction={() => wallet.refetch()} />
        ) : (
          <>
            {/* Reward wallet gradient hero */}
            <View style={styles.heroWrap}>
              <RewardWalletCard wallet={wallet.data!} onPress={() => router.push('/spotlight-wealth/rewards')} />
            </View>

            {/* Creator finance videos carousel */}
            <View style={styles.section}>
              <SectionHeader title="Creator finance videos" actionLabel="See all" onAction={() => router.push('/spotlight-wealth/videos')} />
              {videos.isLoading ? (
                <StateView kind="loading" compact />
              ) : featuredVideos.length === 0 ? (
                <StateView kind="empty" icon="Video" title="No videos yet" message="Creator lessons will appear here." compact />
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
                  {featuredVideos.map((v) => (
                    <VideoCard key={v.id} video={v} onPress={() => router.push('/spotlight-wealth/videos')} />
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Active challenges */}
            <View style={styles.section}>
              <SectionHeader title="Active challenges" />
              {challenges.isLoading ? (
                <StateView kind="loading" compact />
              ) : activeChallenges.length === 0 ? (
                <StateView kind="empty" icon="Target" title="No active challenges" message="New learn-and-earn challenges are coming soon." compact />
              ) : (
                <View style={styles.stack}>
                  {activeChallenges.map((c) => (
                    <ChallengeCard key={c.id} challenge={c} onPress={() => router.push(`/spotlight-wealth/challenges/${c.id}`)} />
                  ))}
                </View>
              )}
            </View>

            {/* Learning leaderboard preview */}
            <View style={styles.section}>
              <SectionHeader title="Learning leaderboard" actionLabel="See all" onAction={() => router.push('/spotlight-wealth/leaderboard')} />
              <View style={styles.cardOuter}>
                <View style={styles.leaderNote}>
                  <Trophy size={14} color={Colors.teal} strokeWidth={2} />
                  <Text style={styles.leaderNoteText}>Ranked by learning points — not profit.</Text>
                </View>
                {leaderboard.isLoading ? (
                  <StateView kind="loading" compact />
                ) : (
                  topLearners.map((e, i, arr) => (
                    <View key={e.rank}>
                      <LeaderboardRow entry={e} highlight={e.displayName === 'You'} />
                      {i < arr.length - 1 ? <View style={styles.divider} /> : null}
                    </View>
                  ))
                )}
              </View>
            </View>

            {/* Campaigns */}
            <View style={styles.section}>
              <SectionHeader title="Campaigns" />
              {campaigns.isLoading ? (
                <StateView kind="loading" compact />
              ) : featuredCampaigns.length === 0 ? (
                <StateView kind="empty" icon="Megaphone" title="No campaigns yet" message="Education campaigns will appear here." compact />
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
                  {featuredCampaigns.map((c) => (
                    <CampaignCard key={c.id} campaign={c} variant="carousel" onPress={() => router.push(`/spotlight-wealth/campaign/${c.id}`)} />
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Creator disclaimer */}
            <View style={styles.disclaimer}>
              <CreatorDisclaimer />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  heroWrap: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  section: { marginTop: Spacing.lg },
  stack: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  carousel: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  cardOuter: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  leaderNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.xs },
  leaderNoteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  disclaimer: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
});
