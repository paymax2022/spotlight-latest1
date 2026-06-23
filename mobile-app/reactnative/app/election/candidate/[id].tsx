import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Vote, Award } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ElectionColors } from '@/features/election/constants/election.constants';
import { derivedStatus, totalVotesFor } from '@/features/election/utils/electionFormatters';
import { useElection } from '@/features/election/hooks/useElection';

export default function CandidateProfileScreen() {
  const { id: candidateId, electionId } = useLocalSearchParams<{ id: string; electionId?: string }>();
  const election = useElection(electionId ?? '');

  if (election.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Candidate" />
        <StateView kind="loading" message="Loading candidate…" />
      </SafeAreaView>
    );
  }

  const e = election.data;
  const position = e?.positions.find((p) => p.candidates.some((c) => c.id === candidateId));
  const candidate = position?.candidates.find((c) => c.id === candidateId);

  if (election.isError || !e || !position || !candidate) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Candidate" />
        <StateView kind="error" icon="UserX" title="Candidate not found" message="This candidate is no longer available." />
      </SafeAreaView>
    );
  }

  const status = derivedStatus(e);
  const showResults = status === 'results_published';
  const total = totalVotesFor(position.candidates);
  const pct = total ? Math.round((candidate.votes / total) * 100) : 0;
  const leading = showResults && candidate.votes === Math.max(...position.candidates.map((c) => c.votes)) && candidate.votes > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={position.title} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{candidate.name.charAt(0)}</Text></View>
          <Text style={styles.name}>{candidate.name}</Text>
          <Text style={styles.role}>Running for {position.title}</Text>
          {leading ? (
            <View style={styles.leadPill}><Award size={14} color={ElectionColors.live} strokeWidth={2} /><Text style={styles.leadText}>Leading</Text></View>
          ) : null}
        </View>

        {showResults ? (
          <View style={styles.statRow}>
            <Stat value={String(candidate.votes)} label="Votes" />
            <Stat value={`${pct}%`} label="Share" />
          </View>
        ) : (
          <View style={styles.runningCard}>
            <Vote size={18} color={Colors.primary} strokeWidth={1.8} />
            <Text style={styles.runningText}>Voting is open. Tallies are hidden until the election closes.</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Manifesto</Text>
          <Text style={styles.manifesto}>{candidate.manifesto ?? 'This candidate has not submitted a manifesto.'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, ...shadow1 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  avatarText: { ...Typography.headlineMd, color: Colors.onPrimary },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  role: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  leadPill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: Spacing.xs, backgroundColor: ElectionColors.liveBg, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  leadText: { ...Typography.labelSm, color: ElectionColors.live, fontWeight: '700' },
  statRow: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, paddingVertical: Spacing.md, ...shadow1 },
  statValue: { ...Typography.headlineMd, color: Colors.onSurface },
  statLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  runningCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md },
  runningText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.xs, ...shadow1 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  manifesto: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
});
