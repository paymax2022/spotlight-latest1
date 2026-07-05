import React from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Trophy, EyeOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { useLeaderboardState } from '@/features/voting/hooks/useLeaderboard';
import { useContestDetails } from '@/features/voting/hooks/useContestDetails';
import TopThreePodium from '@/features/voting/components/TopThreePodium';
import LeaderboardRow from '@/features/voting/components/LeaderboardRow';
import ContestStatusBadge from '@/features/voting/components/ContestStatusBadge';
import CountdownTimer from '@/features/voting/components/CountdownTimer';

export default function LeaderboardScreen() {
  const { contestId } = useLocalSearchParams<{ contestId: string }>();
  const { data: contest } = useContestDetails(contestId ?? '');
  const { data: lbState, isLoading, refetch, isRefetching } = useLeaderboardState(contestId ?? '');

  // Admin can hide the leaderboard for the contest or its active phase.
  const hidden = lbState?.hidden === true || contest?.showLeaderboard === false;
  const hiddenReason =
    lbState?.reason ??
    (contest?.activePhaseLabel
      ? `The leaderboard is hidden during ${contest.activePhaseLabel}.`
      : 'The organiser has hidden the leaderboard for this contest.');

  const leaderboard = hidden ? [] : (lbState?.entries ?? []);
  const topThree = leaderboard.filter((e) => e.rank <= 3);
  const restList = leaderboard.filter((e) => e.rank > 3);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Leaderboard</Text>
          {contest && <Text style={styles.subtitle} numberOfLines={1}>{contest.title}</Text>}
        </View>
        {contest && <ContestStatusBadge status={contest.status} size="sm" />}
      </View>

      {/* Countdown */}
      {contest?.status === 'LIVE' && (
        <View style={styles.countdownRow}>
          <Text style={styles.countdownLabel}>Voting closes in</Text>
          <CountdownTimer endsAt={contest.endsAt} color={Colors.primary} />
        </View>
      )}

      {isLoading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : hidden ? (
        <View style={styles.empty}>
          <EyeOff size={40} color={Colors.onSurfaceVariant} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>Leaderboard hidden</Text>
          <Text style={styles.emptySub}>{hiddenReason}</Text>
        </View>
      ) : (
        <FlatList
          data={restList}
          keyExtractor={(e) => e.contestant.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
          ListHeaderComponent={
            <>
              {topThree.length > 0 && (
                <View style={[styles.podiumCard, shadow1]}>
                  <View style={styles.podiumHeader}>
                    <Trophy size={16} color='#F59E0B' strokeWidth={2} />
                    <Text style={styles.podiumTitle}>Top 3</Text>
                  </View>
                  <TopThreePodium entries={topThree} />
                </View>
              )}
              {restList.length > 0 && (
                <Text style={styles.restLabel}>Full Rankings</Text>
              )}
            </>
          }
          renderItem={({ item, index }) => (
            <View style={styles.rowWrap}>
              <LeaderboardRow
                entry={item}
                onPress={() => router.push(`/voting/contestant-profile?contestantId=${item.contestant.id}&contestId=${contestId}`)}
                onVote={() => router.push(`/voting/contestant-profile?contestantId=${item.contestant.id}&contestId=${contestId}`)}
              />
              {index < restList.length - 1 && <View style={styles.divider} />}
            </View>
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No rankings yet</Text>
              <Text style={styles.emptySub}>Leaderboard will appear once voting begins.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  header:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, gap: Spacing.sm },
  backBtn:   { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1 },
  title:     { ...Typography.titleLg, color: Colors.onSurface },
  subtitle:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  countdownLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:      { padding: Spacing.containerMargin, paddingBottom: 100, gap: 0 },
  podiumCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  podiumHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.md },
  podiumTitle: { ...Typography.titleMd, color: Colors.onSurface },
  restLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  rowWrap:   { backgroundColor: Colors.surfaceContainerLowest, borderRadius: 0 },
  divider:   { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginHorizontal: Spacing.md },
  empty:     { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  emptySub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
