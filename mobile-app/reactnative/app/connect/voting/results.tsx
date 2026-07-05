import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { ShieldCheck, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useContestLeaderboard } from '@/features/connect/voting/hooks';

/** Live results / tally (PRD §10.8 VT-05). */
export default function ResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useContestLeaderboard(id ?? '');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Live results" subtitle="Updated in real time" />
      {q.isLoading ? (
        <StateView kind="loading" message="Tallying votes…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn't load results" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Trophy" title="No votes yet" message="Results will appear once voting begins." />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {(q.data ?? []).map((e) => {
            const top = e.rank === 1;
            return (
              <View key={e.contestantId} style={[styles.row, top && styles.rowTop]}>
                <View style={styles.rankWrap}>
                  {top ? <Trophy size={18} color={ConnectColors.warn} strokeWidth={2.2} /> : <Text style={styles.rank}>{e.rank}</Text>}
                </View>
                <Image source={{ uri: e.avatar }} style={styles.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{e.name}</Text>
                  <View style={styles.barTrack}><View style={[styles.barFill, { width: `${e.sharePct}%` }, top && styles.barTop]} /></View>
                </View>
                <View style={styles.rightCol}>
                  <Text style={styles.votes}>{e.votes.toLocaleString('en-NG')}</Text>
                  <Text style={styles.pct}>{e.sharePct}%</Text>
                </View>
              </View>
            );
          })}

          <View style={styles.integrity}>
            <ShieldCheck size={15} color={ConnectColors.ok} strokeWidth={2.2} />
            <Text style={styles.integrityText}>Tallies are audited. Bot, sybil and vote-buying activity is removed from results.</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  rowTop: { borderColor: ConnectColors.warn, backgroundColor: Colors.iconBgGold },
  rankWrap: { width: 26, alignItems: 'center' },
  rank: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surfaceContainer },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  barTrack: { height: 7, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden', marginTop: 5 },
  barFill: { height: '100%', borderRadius: Radius.full, backgroundColor: ConnectColors.brand },
  barTop: { backgroundColor: ConnectColors.warn },
  rightCol: { alignItems: 'flex-end' },
  votes: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  pct: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  integrity: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: ConnectColors.okBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  integrityText: { ...Typography.caption, color: Colors.onSurface, flex: 1, lineHeight: 17 },
});
