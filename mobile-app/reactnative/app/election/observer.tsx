import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Eye, Users, Lock, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import MetricBar from '@/features/visitor/components/MetricBar';
import { ElectionColors, ELECTION_STATUS_LABELS } from '@/features/election/constants/election.constants';
import { countdownLabel, derivedStatus, totalVotesFor } from '@/features/election/utils/electionFormatters';
import { useActiveElection, useElection, useElections } from '@/features/election/hooks/useElection';

// Read-only election monitor for observers/auditors (PRD Section J — Observer
// access). No voting controls. Tallies stay sealed until results are published;
// live turnout is always visible.
export default function ElectionObserverScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const active = useActiveElection();
  const list = useElections();
  const resolvedId = params.id ?? active.data?.id ?? list.data?.[0]?.id ?? '';
  const election = useElection(resolvedId);

  if (!resolvedId || election.isLoading || active.isLoading || list.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Observer" />
        {!resolvedId && !active.isLoading && !list.isLoading ? (
          <StateView kind="empty" icon="Eye" title="No elections" message="There are no elections to observe yet." />
        ) : (
          <StateView kind="loading" message="Loading election…" />
        )}
      </SafeAreaView>
    );
  }

  if (election.isError || !election.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Observer" />
        <StateView kind="error" title="Couldn't load election" message="Please try again." actionLabel="Retry" onAction={() => election.refetch()} />
      </SafeAreaView>
    );
  }

  const e = election.data;
  const status = derivedStatus(e);
  const published = status === 'results_published';
  const turnoutPct = e.totalEligibleVoters ? Math.round((e.votesCast / e.totalEligibleVoters) * 100) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Observer" subtitle="Read-only" rightSlot={<View style={styles.obsPill}><Eye size={14} color={Colors.secondary} strokeWidth={2} /><Text style={styles.obsText}>Observing</Text></View>} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.title}>{e.title}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.statusChip, { backgroundColor: status === 'live' ? ElectionColors.liveBg : ElectionColors.closedBg }]}>
              <Text style={[styles.statusText, { color: status === 'live' ? ElectionColors.live : ElectionColors.closed }]}>{ELECTION_STATUS_LABELS[status]}</Text>
            </View>
            <View style={styles.metaItem}><Clock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>{countdownLabel(e)}</Text></View>
          </View>
        </View>

        {/* Turnout (always visible) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Turnout</Text>
          <View style={styles.turnoutRow}>
            <Users size={18} color={Colors.secondary} strokeWidth={1.8} />
            <Text style={styles.turnoutValue}>{e.votesCast} / {e.totalEligibleVoters}</Text>
            <Text style={styles.turnoutPct}>{turnoutPct}%</Text>
          </View>
          <MetricBar label="" value={e.votesCast} max={Math.max(1, e.totalEligibleVoters)} color={Colors.secondary} />
        </View>

        {/* Results — sealed until published */}
        {published ? (
          e.positions.map((p) => {
            const total = totalVotesFor(p.candidates);
            const max = Math.max(1, ...p.candidates.map((c) => c.votes));
            return (
              <View key={p.id} style={styles.card}>
                <Text style={styles.cardTitle}>{p.title}</Text>
                {p.candidates.map((c) => (
                  <View key={c.id} style={styles.resultRow}>
                    <View style={styles.resultHead}>
                      <Text style={styles.candName}>{c.name}</Text>
                      <Text style={styles.candPct}>{total ? Math.round((c.votes / total) * 100) : 0}%</Text>
                    </View>
                    <MetricBar label="" value={c.votes} max={max} color={Colors.primary} />
                  </View>
                ))}
              </View>
            );
          })
        ) : (
          <View style={styles.sealed}>
            <Lock size={20} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            <Text style={styles.sealedText}>Results are sealed until the election closes and an admin publishes them. Live turnout is shown above.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  obsPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  obsText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' },
  hero: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm, ...shadow1 },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  statusText: { ...Typography.labelSm, fontWeight: '700' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: 2, ...shadow1 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.xs },
  turnoutRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  turnoutValue: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  turnoutPct: { ...Typography.titleMd, color: Colors.secondary },
  resultRow: { gap: 2, paddingVertical: 4 },
  resultHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  candName: { ...Typography.labelMd, color: Colors.onSurface },
  candPct: { ...Typography.labelMd, color: Colors.primary },
  sealed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  sealedText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});
