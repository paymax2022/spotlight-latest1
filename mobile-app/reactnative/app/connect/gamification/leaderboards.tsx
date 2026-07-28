import React, { useState } from 'react';
import { View, Text, Image, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Zap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import GameNonCashNotice from '@/features/connect/components/game-NonCashNotice';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useGameLeaderboard } from '@/features/connect/gamification/hooks';
import type { LeaderboardScope, GameLeaderboardEntry } from '@/features/connect/gamification/types';

/** Leaderboards (PRD §10.10 GM-05): gifters, streamers, voters, regional. Points are NON-CASH. */
export default function LeaderboardsScreen() {
  const [scope, setScope] = useState<LeaderboardScope>('gifters');
  const q = useGameLeaderboard(scope);

  function renderItem({ item }: { item: GameLeaderboardEntry }) {
    const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `${item.rank}`;
    return (
      <View style={[styles.row, item.rank <= 3 && styles.rowTop]}>
        <Text style={styles.rank}>{medal}</Text>
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          {item.level != null ? <Text style={styles.level}>Level {item.level}{item.region ? ` · ${item.region}` : ''}</Text> : null}
        </View>
        <View style={styles.points}>
          <Zap size={13} color={ConnectColors.warn} strokeWidth={2.2} />
          <Text style={styles.pointsText}>{item.points.toLocaleString('en-NG')}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Leaderboards" subtitle="Ranked by XP points" />
      <View style={styles.segWrap}>
        <SegmentedControl
          options={[
            { value: 'gifters', label: 'Gifters' },
            { value: 'streamers', label: 'Streamers' },
            { value: 'voters', label: 'Voters' },
            { value: 'regional', label: 'Regional' },
          ]}
          value={scope}
          onChange={setScope}
          scrollable
        />
      </View>
      {q.isLoading ? (
        <StateView kind="loading" message="Loading rankings…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load leaderboard" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Trophy" title="No rankings yet" message="Earn XP to climb the board." />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(e) => e.userId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<View style={{ marginBottom: Spacing.sm }}><GameNonCashNotice compact message="Leaderboard scores are XP points, not money." /></View>}
        />
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
  name: { ...Typography.labelLg, color: Colors.onSurface },
  level: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  points: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pointsText: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
});
