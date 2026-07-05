import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useTeamLeaderboard } from '@/features/referral/agent/hooks';

// M-AGT-05 — Team leaderboard & targets. Ranked by VERIFIED activity (the basis
// of any override) — not by how many people a member recruited.
export default function TeamLeaderboardScreen() {
  const { data, isLoading, isError, refetch } = useTeamLeaderboard();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Team leaderboard" />
      {isLoading ? (
        <StateView kind="loading" message="Loading leaderboard…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Targets */}
          <Text style={styles.sectionTitle}>Team targets</Text>
          <View style={styles.targets}>
            {data.targets.map((t, i) => {
              const pct = Math.min(1, t.current / (t.target || 1));
              return (
                <View key={t.label} style={[styles.target, i < data.targets.length - 1 && styles.targetBorder]}>
                  <View style={styles.targetTop}>
                    <Text style={styles.targetLabel}>{t.label}</Text>
                    <Text style={styles.targetCount}>{t.current}/{t.target} {t.unit}</Text>
                  </View>
                  <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
                </View>
              );
            })}
          </View>

          <DisclosureCard
            tone="compliant"
            title="Ranked by real activity"
            body="The leaderboard ranks members by their verified activity — genuine transactions — not by recruitment. This keeps the team focused on real value."
          />

          {/* Leaderboard */}
          <View style={styles.metaRow}>
            <Text style={styles.sectionTitle}>Rankings</Text>
            {data.resetAt ? <Text style={styles.reset}>Resets {relativeTime(data.resetAt)}</Text> : null}
          </View>
          {data.rows.length === 0 ? (
            <StateView kind="empty" icon="Trophy" title="No rankings yet" message="Members appear here as they transact." compact />
          ) : (
            <View style={styles.board}>
              {data.rows.map((r, i) => (
                <View key={`${r.rank}-${r.name}`} style={[styles.row, r.isYou && styles.rowYou, i < data.rows.length - 1 && styles.rowBorder]}>
                  <Text style={[styles.rank, r.rank <= 3 && styles.rankTop]}>#{r.rank}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.name} numberOfLines={1}>{r.name}{r.isYou ? ' (you)' : ''}</Text>
                    <Text style={styles.rowMeta}>{r.verifiedReferrals} verified referrals</Text>
                  </View>
                  <Text style={styles.activity}>{formatNaira(r.activityKobo)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  targets: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  target: { paddingVertical: Spacing.md, gap: 6 },
  targetBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  targetTop: { flexDirection: 'row', justifyContent: 'space-between' },
  targetLabel: { ...Typography.labelMd, color: Colors.onSurface },
  targetCount: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reset: { ...Typography.caption, color: Colors.onSurfaceVariant },
  board: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowYou: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, marginHorizontal: -Spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rank: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 40 },
  rankTop: { color: Colors.primary, fontWeight: '800' as const },
  rowBody: { flex: 1 },
  name: { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  activity: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
});
