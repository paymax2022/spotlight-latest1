import React, { useState } from 'react';
import { View, Text, Image, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eye } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useLiveLeaderboard } from '@/features/connect/live/hooks';
import type { LiveLeaderboardEntry } from '@/features/connect/live/types';

/** Stream leaderboard — top gifters / streamers (PRD §10.6 LV-09). */
export default function LiveLeaderboardScreen() {
  const [kind, setKind] = useState<'gifters' | 'streamers'>('gifters');
  const q = useLiveLeaderboard(kind);

  function renderItem({ item }: { item: LiveLeaderboardEntry }) {
    const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `${item.rank}`;
    return (
      <View style={[styles.row, item.rank <= 3 && styles.rowTop]}>
        <Text style={styles.rank}>{medal}</Text>
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        {kind === 'gifters' ? (
          <Text style={styles.amount}>{formatKobo(item.amountKobo ?? 0)}</Text>
        ) : (
          <View style={styles.viewers}>
            <Eye size={13} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
            <Text style={styles.viewersText}>{(item.viewers ?? 0).toLocaleString('en-NG')}</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Leaderboard" subtitle="This week" />
      <View style={styles.segWrap}>
        <SegmentedControl
          options={[{ value: 'gifters', label: 'Top gifters' }, { value: 'streamers', label: 'Top streamers' }]}
          value={kind}
          onChange={setKind}
        />
      </View>
      {kind === 'gifters' ? (
        <Text style={styles.hint}>Amounts are real Naira gifted from wallets.</Text>
      ) : null}

      {q.isLoading ? (
        <StateView kind="loading" message="Loading leaderboard…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load leaderboard" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Trophy" title="No rankings yet" message="Be the first on the board." />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(e) => `${e.userId}-${e.rank}`}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segWrap: { paddingVertical: Spacing.sm },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  rowTop: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  rank: { ...Typography.titleMd, color: Colors.onSurface, width: 28, textAlign: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceContainer },
  name: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  amount: { ...Typography.labelLg, color: ConnectColors.brand, fontWeight: '700' as const },
  viewers: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewersText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
