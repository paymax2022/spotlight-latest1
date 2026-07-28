import React, { useState } from 'react';
import { View, Text, Image, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useContests, useContestLeaderboard } from '@/features/connect/voting/hooks';
import type { VoteLeaderboardEntry } from '@/features/connect/voting/types';

/** Cross-contest voting leaderboard (PRD §10.8 VT-05). Picks a contest, shows its tally. */
export default function VotingLeaderboardScreen() {
  const contestsQ = useContests('active');
  const contests = contestsQ.data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? contests[0]?.id ?? '';
  const lbQ = useContestLeaderboard(activeId);

  function renderItem({ item }: { item: VoteLeaderboardEntry }) {
    const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `${item.rank}`;
    return (
      <View style={[styles.row, item.rank <= 3 && styles.rowTop]}>
        <Text style={styles.rank}>{medal}</Text>
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <View style={styles.rightCol}>
          <Text style={styles.votes}>{item.votes.toLocaleString('en-NG')}</Text>
          <Text style={styles.pct}>{item.sharePct}%</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Voting leaderboard" subtitle="Top contestants" />
      {contestsQ.isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : contests.length === 0 ? (
        <StateView kind="empty" icon="Trophy" title="No active contests" message="Check back when voting opens." actionLabel="Browse contests" onAction={() => router.replace('/connect/voting/contests')} />
      ) : (
        <>
          <View style={styles.segWrap}>
            <SegmentedControl
              options={contests.map((c) => ({ value: c.id, label: c.title.length > 16 ? c.title.slice(0, 15) + '…' : c.title }))}
              value={activeId}
              onChange={setSelected}
              scrollable
            />
          </View>
          {lbQ.isLoading ? (
            <StateView kind="loading" message="Loading tally…" />
          ) : lbQ.isError ? (
            <StateView kind="error" title="Couldn't load leaderboard" actionLabel="Retry" onAction={() => lbQ.refetch()} />
          ) : (
            <FlatList
              data={lbQ.data ?? []}
              keyExtractor={(e) => e.contestantId}
              renderItem={renderItem}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={
                <View style={styles.integrity}>
                  <ShieldCheck size={15} color={ConnectColors.ok} strokeWidth={2.2} />
                  <Text style={styles.integrityText}>Rankings are audited for bot and vote-buying activity.</Text>
                </View>
              }
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segWrap: { paddingVertical: Spacing.sm },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  rowTop: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  rank: { ...Typography.titleMd, color: Colors.onSurface, width: 28, textAlign: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceContainer },
  name: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  rightCol: { alignItems: 'flex-end' },
  votes: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  pct: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  integrity: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: ConnectColors.okBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  integrityText: { ...Typography.caption, color: Colors.onSurface, flex: 1, lineHeight: 17 },
});
