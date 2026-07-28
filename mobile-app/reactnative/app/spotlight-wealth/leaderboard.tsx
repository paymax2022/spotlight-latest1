import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GraduationCap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import LeaderboardRow from '@/features/spotlightwealth/components/LeaderboardRow';
import { useLeaderboard } from '@/features/spotlightwealth/hooks/useSpotlight';
import { LEADERBOARD_DISCLAIMER } from '@/features/spotlightwealth/constants/spotlight.constants';

export default function LeaderboardScreen() {
  const leaderboard = useLeaderboard();
  const list = leaderboard.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Learning leaderboard" subtitle="Points from lessons & quizzes" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={leaderboard.isRefetching} onRefresh={() => leaderboard.refetch()} tintColor={Colors.primary} />}
      >
        {/* Explicit "not profit" disclaimer banner */}
        <View style={styles.note}>
          <View style={styles.noteIcon}><GraduationCap size={16} color={Colors.teal} strokeWidth={2} /></View>
          <Text style={styles.noteText}>{LEADERBOARD_DISCLAIMER}</Text>
        </View>

        {leaderboard.isLoading ? (
          <StateView kind="loading" message="Loading leaderboard…" />
        ) : leaderboard.isError ? (
          <StateView kind="error" title="Couldn't load leaderboard" message="Please check your connection and try again." actionLabel="Retry" onAction={() => leaderboard.refetch()} />
        ) : list.length === 0 ? (
          <StateView kind="empty" icon="Trophy" title="No rankings yet" message="Complete lessons and quizzes to earn learning points." />
        ) : (
          <View style={[styles.card, shadow1]}>
            {list.map((e, i, arr) => (
              <View key={e.rank}>
                <LeaderboardRow entry={e} highlight={e.displayName === 'You'} />
                {i < arr.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  note: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  noteIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 17 },
  card: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
