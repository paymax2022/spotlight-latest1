import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { ElectionColors } from '@/features/election/constants/election.constants';
import { useElection, useMyBallot } from '@/features/election/hooks/useElection';

export default function VoteReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const election = useElection(id ?? '');
  const ballot = useMyBallot(id ?? '');

  if (election.isLoading || ballot.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Vote receipt" />
        <StateView kind="loading" message="Loading receipt…" />
      </SafeAreaView>
    );
  }

  const e = election.data;
  const choices = ballot.data?.choices ?? {};
  const voted = Object.keys(choices).length;

  if (election.isError || !e || voted === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Vote receipt" />
        <StateView kind="empty" icon="Vote" title="No vote recorded" message="You haven't cast a vote in this election yet." actionLabel={e ? 'Go to election' : undefined} onAction={e ? () => router.replace(`/election?id=${e.id}`) : undefined} />
      </SafeAreaView>
    );
  }

  const ref = `VR-${(ballot.data?.submittedAt ? +new Date(ballot.data.submittedAt) : Date.now()).toString().slice(-8)}`;
  const when = ballot.data?.submittedAt ? new Date(ballot.data.submittedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Vote receipt" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><CheckCircle2 size={40} color={ElectionColors.live} strokeWidth={1.6} /></View>
          <Text style={styles.heroTitle}>Vote recorded</Text>
          <Text style={styles.heroSub}>{e.title}</Text>
        </View>

        <View style={styles.card}>
          <Row label="Reference" value={ref} mono />
          <Row label="Submitted" value={when} />
          <Row label="Positions voted" value={`${voted} of ${e.positions.length}`} />
        </View>

        <Text style={styles.sectionLabel}>Your choices</Text>
        <View style={styles.card}>
          {e.positions.map((p, i) => {
            const candidate = p.candidates.find((c) => c.id === choices[p.id]);
            return (
              <View key={p.id} style={[styles.choiceRow, i > 0 && styles.divider]}>
                <Text style={styles.choicePos}>{p.title}</Text>
                <Text style={styles.choiceCand}>{candidate ? candidate.name : 'Not voted'}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.secure}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={1.8} />
          <Text style={styles.secureText}>Your ballot is confidential. This receipt confirms your vote was counted.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Done" onPress={() => router.replace(`/election?id=${e.id}`)} />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, ...shadow1 },
  heroIcon: { width: 72, height: 72, borderRadius: Radius.xxl, backgroundColor: ElectionColors.liveBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  heroSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface },
  mono: { letterSpacing: 1 },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  choiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  choicePos: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  choiceCand: { ...Typography.labelMd, color: Colors.onSurface },
  secure: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md },
  secureText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
