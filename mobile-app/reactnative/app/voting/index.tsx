import React from 'react';
import {
  ScrollView, View, Text, StyleSheet, Platform, RefreshControl, ActivityIndicator, Pressable, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bell, ChevronRight, Trophy, UserPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import { useAuthStore } from '@/store/authStore';
import { useContests } from '@/features/voting/hooks/useContests';
import { useContestants } from '@/features/voting/hooks/useContestants';
import { useLeaderboard } from '@/features/voting/hooks/useLeaderboard';
import { useFreeVoteAllocation } from '@/features/voting/hooks/useVote';
import ContestCard from '@/features/voting/components/ContestCard';
import ContestStatusBadge from '@/features/voting/components/ContestStatusBadge';
import FreeVoteBadge from '@/features/voting/components/FreeVoteBadge';
import LeaderboardRow from '@/features/voting/components/LeaderboardRow';
import SponsorBanner from '@/features/voting/components/SponsorBanner';
import ContestHero from '@/features/voting/components/ContestHero';
import CountdownTimer from '@/features/voting/components/CountdownTimer';
import { formatVoteCount } from '@/features/voting/utils/voteFormatters';



export default function VotingHomeScreen() {
  const { user } = useAuthStore();
  const firstName = user?.fullName?.split(' ')[0] ?? 'there';

  const { data: contests, isLoading: loadingContests, refetch, isRefetching } = useContests({ status: 'LIVE' });

  // The featured contest is whichever live contest comes first — NOT a
  // hardcoded id. Pointing these at a fixed mock id ('c1') meant the leaderboard
  // and free-vote lookups 404'd against real data.
  const featuredContest = contests?.[0];
  const featuredContestId = featuredContest?.id;

  const { data: leaderboard } = useLeaderboard(featuredContestId ?? '');
  const { data: freeVotes } = useFreeVoteAllocation(featuredContestId ?? '');
  const liveContests    = contests ?? [];
  const topEntries      = (leaderboard ?? []).slice(0, 3);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hey {firstName} 👋</Text>
            <Text style={styles.headerTitle}>Spotlight Contest</Text>
          </View>
          <Pressable onPress={() => router.push('/voting/notifications')} style={styles.bellBtn}>
            <Bell size={22} color={Colors.onSurface} strokeWidth={1.8} />
          </Pressable>
        </View>

        {/* Register / Apply to compete */}
        <Pressable
          onPress={() => router.push('/registration')}
          style={({ pressed }) => [styles.registerCard, shadow1, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityLabel="Register or apply to compete in a contest"
        >
          <View style={styles.registerIcon}>
            <UserPlus size={20} color={Colors.onPrimary} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.registerTitle}>Register / Apply to Compete</Text>
            <Text style={styles.registerSub}>Enter an open contest as a contestant</Text>
          </View>
          <ChevronRight size={18} color={Colors.onPrimary} strokeWidth={2} />
        </Pressable>

        {/* Free votes strip */}
        {freeVotes && (
          <Pressable
            onPress={() => featuredContestId && router.push(`/voting/contestants?contestId=${featuredContestId}`)}
            style={[styles.freeVoteCard, shadow1]}
          >
            <FreeVoteBadge remaining={freeVotes.remaining} total={freeVotes.total} />
            <Text style={styles.freeVoteText}>
              {freeVotes.remaining > 0
                ? 'Cast your daily free votes now!'
                : 'Free votes reset at midnight. Buy votes to keep supporting!'}
            </Text>
            <ChevronRight size={16} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        )}

        {/* Featured contest hero */}
        {loadingContests ? (
          <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
        ) : featuredContest ? (
          <Pressable
            onPress={() => router.push(`/voting/contest-details?contestId=${featuredContest.id}`)}
            style={styles.heroWrap}
          >
            <ContestHero contest={featuredContest} height={280} />
          </Pressable>
        ) : null}

        {/* Sponsor */}
        {featuredContest?.sponsorName && (
          <View style={styles.sponsorRow}>
            <SponsorBanner sponsorName={featuredContest.sponsorName} />
          </View>
        )}

        {/* Active contests carousel */}
        <SectionHeader
          title="Active Contests"
          actionLabel="View All"
          onAction={() => router.push('/voting/contests')}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
          {liveContests.map((contest) => (
            <ContestCard
              key={contest.id}
              contest={contest}
              onPress={() => router.push(`/voting/contest-details?contestId=${contest.id}`)}
              style={styles.contestCardH}
            />
          ))}
          {liveContests.length === 0 && !loadingContests && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No active contests right now.</Text>
            </View>
          )}
        </ScrollView>

        {/* Leaderboard preview — hidden when the organiser disables it */}
        {featuredContest?.showLeaderboard !== false && topEntries.length > 0 && (
          <>
            <SectionHeader
              title="Leaderboard Preview"
              actionLabel="Full Board"
              onAction={() => featuredContestId && router.push(`/voting/leaderboard?contestId=${featuredContestId}`)}
            />
            <View style={[styles.leaderCard, shadow1]}>
              <View style={styles.leaderHeader}>
                <Trophy size={16} color={Colors.primary} strokeWidth={1.8} />
                <Text style={styles.leaderTitle}>{featuredContest?.title ?? 'Spotlight Music Talent 2026'}</Text>
                <ContestStatusBadge status={featuredContest?.status ?? 'LIVE'} size="sm" />
              </View>
              {topEntries.map((entry, i) => (
                <View key={entry.contestant.id}>
                  <LeaderboardRow
                    entry={entry}
                    onPress={() => router.push(`/voting/contestant-profile?contestantId=${entry.contestant.id}&contestId=${featuredContestId}`)}
                    onVote={() => router.push(`/voting/contestant-profile?contestantId=${entry.contestant.id}&contestId=${featuredContestId}`)}
                  />
                  {i < topEntries.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
              <Pressable
                onPress={() => router.push(`/voting/leaderboard?contestId=${featuredContestId}`)}
                style={styles.seeAllBtn}
              >
                <Text style={styles.seeAllText}>See full leaderboard</Text>
                <ChevronRight size={14} color={Colors.primary} strokeWidth={2} />
              </Pressable>
            </View>
          </>
        )}

        <View style={{ height: Platform.OS === 'ios' ? 100 : 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  scroll:  { flex: 1 },
  content: { paddingBottom: Spacing.xl },
  registerCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.md, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  registerIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  registerTitle: { ...Typography.labelLg, color: Colors.onPrimary },
  registerSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  header:  {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    paddingHorizontal: Spacing.containerMargin,
    paddingVertical:  Spacing.md,
  },
  greeting:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerTitle: { ...Typography.headlineLgMobile, color: Colors.onSurface },
  bellBtn:     { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  freeVoteCard: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              Spacing.sm,
    marginHorizontal: Spacing.containerMargin,
    marginBottom:     Spacing.md,
    backgroundColor:  Colors.surfaceContainerLowest,
    borderRadius:     Radius.lg,
    padding:          Spacing.md,
    borderWidth:      1,
    borderColor:      Colors.surfaceContainerHigh,
  },
  freeVoteText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1 },
  heroWrap:     { marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  sponsorRow:   { paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  loader:       { paddingVertical: Spacing.xl, alignItems: 'center' },
  carousel:     { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.sm },
  contestCardH: { width: 240 },
  emptyCard:    { padding: Spacing.xl, alignItems: 'center' },
  emptyText:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  leaderCard: {
    backgroundColor:  Colors.surfaceContainerLowest,
    borderRadius:     Radius.xl,
    marginHorizontal: Spacing.containerMargin,
    padding:          Spacing.md,
    borderWidth:      1,
    borderColor:      Colors.surfaceContainerHigh,
    marginBottom:     Spacing.md,
  },
  leaderHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  leaderTitle:  { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  divider:      { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  seeAllBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: Spacing.md },
  seeAllText:   { ...Typography.labelMd, color: Colors.primary },
});
