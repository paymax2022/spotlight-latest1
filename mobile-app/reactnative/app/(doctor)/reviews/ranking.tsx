import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, RankingGauge } from '@/features/doctor/components';
import { useRankingInsight } from '@/features/doctor/hooks';
import type { RankingPeerStat } from '@/types/doctor.batch6';

// Z.11: profile ranking insight (percentile gauge + peer comparison).
export default function RankingInsightScreen() {
  const { data: ranking, isLoading, isError, refetch } = useRankingInsight();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Ranking Insight" />

      {isLoading && !ranking ? (
        <StateView variant="loading" label="Loading ranking" />
      ) : isError || !ranking ? (
        <StateView variant="error" message="We could not load your ranking." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <RankingGauge
            percentile={ranking.percentile}
            rankLabel={ranking.rankLabel}
            specialty={ranking.specialty}
            movement={ranking.movement}
            movementPlaces={ranking.movementPlaces}
          />

          {ranking.peerStats.length === 0 ? (
            <StateView variant="empty" icon={TrendingUp} title="No peer data" message="Peer comparisons will appear here." />
          ) : (
            <SectionCard title="You vs peers" style={styles.card}>
              {ranking.peerStats.map((s, i) => <PeerRow key={s.label} stat={s} border={i > 0} />)}
            </SectionCard>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PeerRow({ stat, border }: { stat: RankingPeerStat; border: boolean }) {
  const better = stat.betterIsHigh ? stat.yourValue >= stat.peerMedian : stat.yourValue <= stat.peerMedian;
  return (
    <View style={[styles.peerRow, border && styles.border]}>
      <Text style={styles.peerLabel} numberOfLines={1}>{stat.label}</Text>
      <View style={styles.peerValues}>
        <Text style={[styles.peerYou, { color: better ? Colors.teal : Colors.onSurface }]}>{stat.yourValue}{stat.unit}</Text>
        <Text style={styles.peerMedian}>peer {stat.peerMedian}{stat.unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.md, flexGrow: 1 },
  card:       { marginBottom: 0 },
  peerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingVertical: Spacing.sm },
  border:     { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  peerLabel:  { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  peerValues: { alignItems: 'flex-end', gap: 2 },
  peerYou:    { ...Typography.titleMd, fontWeight: '700' },
  peerMedian: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
