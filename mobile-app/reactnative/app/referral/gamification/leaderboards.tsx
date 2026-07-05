import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles, TrendingUp, TrendingDown, Minus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { relativeTime } from '@/features/referral/constants/format';
import { useLeaderboard } from '@/features/referral/gamification/hooks';
import type { LeaderboardScope } from '@/features/referral/gamification/types';

// M-GAM-05 — Leaderboards. Scope: friends / estate / campaign / global.
const SCOPES: { key: LeaderboardScope; label: string }[] = [
  { key: 'friends', label: 'Friends' },
  { key: 'estate', label: 'Estate' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'global', label: 'Global' },
];

export default function LeaderboardsScreen() {
  const [scope, setScope] = useState<LeaderboardScope>('friends');
  const { data, isLoading, isError, refetch } = useLeaderboard(scope);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Leaderboards" />

      <View style={styles.tabs}>
        {SCOPES.map((s) => (
          <Pressable key={s.key} style={[styles.tab, scope === s.key && styles.tabActive]} onPress={() => setScope(s.key)} accessibilityRole="button">
            <Text style={[styles.tabText, scope === s.key && styles.tabTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading leaderboard…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.metaRow}>
            <View style={styles.pointsTag}><Sparkles size={13} color={Colors.secondary} strokeWidth={2} /><Text style={styles.pointsTagText}>Ranked by non-cash points</Text></View>
            {data.resetAt ? <Text style={styles.reset}>Resets {relativeTime(data.resetAt)}</Text> : <Text style={styles.reset}>All-time</Text>}
          </View>

          {data.rows.length === 0 ? (
            <StateView kind="empty" icon="Trophy" title="No rankings yet" message="Be the first to climb this board." compact />
          ) : (
            <View style={styles.board}>
              {data.rows.map((r, i) => (
                <View key={`${r.rank}-${r.name}`} style={[styles.row, r.isYou && styles.rowYou, i < data.rows.length - 1 && styles.rowBorder]}>
                  <Text style={[styles.rank, r.rank <= 3 && styles.rankTop]}>#{r.rank}</Text>
                  <Text style={[styles.name, r.isYou && styles.nameYou]} numberOfLines={1}>{r.name}{r.isYou ? ' (you)' : ''}</Text>
                  <Delta delta={r.delta} />
                  <Text style={styles.points}>{r.points.toLocaleString('en-NG')} pts</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Delta({ delta }: { delta: number }) {
  if (delta === 0) return <Minus size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />;
  if (delta > 0) return <View style={styles.deltaWrap}><TrendingUp size={14} color={Colors.tertiaryContainer} strokeWidth={2} /><Text style={styles.deltaUp}>{delta}</Text></View>;
  return <View style={styles.deltaWrap}><TrendingDown size={14} color={Colors.error} strokeWidth={2} /><Text style={styles.deltaDown}>{Math.abs(delta)}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tabs: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  tab: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center' },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '700' as const },
  tabTextActive: { color: Colors.onPrimary },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pointsTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pointsTagText: { ...Typography.caption, color: Colors.secondary },
  reset: { ...Typography.caption, color: Colors.onSurfaceVariant },
  board: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowYou: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, marginHorizontal: -Spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rank: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 44 },
  rankTop: { color: Colors.primary, fontWeight: '800' as const },
  name: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  nameYou: { fontWeight: '800' as const },
  deltaWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  deltaUp: { ...Typography.caption, color: Colors.tertiaryContainer },
  deltaDown: { ...Typography.caption, color: Colors.error },
  points: { ...Typography.labelMd, color: Colors.onSurface, width: 84, textAlign: 'right' },
});
