import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Zap, Coins, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import GameNonCashNotice from '@/features/connect/components/game-NonCashNotice';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useMissions, useClaimMission } from '@/features/connect/gamification/hooks';
import type { Mission, MissionPeriod } from '@/features/connect/gamification/types';

/** Missions / quests (PRD §10.10 GM-02). Rewards are NON-CASH XP + coins. */
export default function MissionsScreen() {
  const [period, setPeriod] = useState<MissionPeriod>('daily');
  const q = useMissions();
  const claim = useClaimMission();
  const missions = (q.data ?? []).filter((m) => m.period === period);

  function renderItem({ item }: { item: Mission }) {
    const pct = Math.min(100, Math.round((item.progress / item.target) * 100));
    const claimable = item.status === 'completed';
    const claimed = item.status === 'claimed';
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.desc}>{item.description}</Text>
          </View>
          {claimed ? <CircleCheck size={20} color={ConnectColors.ok} strokeWidth={2} /> : null}
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
        <View style={styles.cardBottom}>
          <View style={styles.rewards}>
            <View style={styles.reward}><Zap size={13} color={ConnectColors.warn} strokeWidth={2.2} /><Text style={styles.rewardText}>{item.xpReward} XP</Text></View>
            <View style={styles.reward}><Coins size={13} color={ConnectColors.warn} strokeWidth={2.2} /><Text style={styles.rewardText}>{item.coinReward}</Text></View>
            <Text style={styles.progress}>{item.progress}/{item.target}</Text>
          </View>
          {claimable ? (
            <Pressable style={styles.claimBtn} onPress={() => claim.mutate(item.id)} disabled={claim.isPending} accessibilityRole="button" accessibilityLabel={`Claim ${item.title}`}>
              <Text style={styles.claimText}>Claim</Text>
            </Pressable>
          ) : claimed ? (
            <Text style={styles.claimedText}>Claimed</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Missions" subtitle="Complete tasks for XP & coins" />
      <View style={styles.segWrap}>
        <SegmentedControl options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} value={period} onChange={setPeriod} />
      </View>
      {q.isLoading ? (
        <StateView kind="loading" message="Loading missions…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load missions" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : missions.length === 0 ? (
        <StateView kind="empty" icon="ListChecks" title="No missions" message="Check back soon for new tasks." />
      ) : (
        <FlatList
          data={missions}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<View style={{ marginBottom: Spacing.sm }}><GameNonCashNotice compact /></View>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segWrap: { paddingVertical: Spacing.sm },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  desc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  track: { height: 7, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: ConnectColors.brand },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rewards: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rewardText: { ...Typography.labelSm, color: Colors.onSurface },
  progress: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  claimBtn: { backgroundColor: ConnectColors.brand, paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full },
  claimText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  claimedText: { ...Typography.labelMd, color: ConnectColors.ok, fontWeight: '700' as const },
});
