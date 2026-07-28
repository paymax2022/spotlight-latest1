import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Vote, Users, CheckCircle2, Circle, ShieldAlert, Clock, ChevronRight, Settings2, Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MetricBar from '@/features/visitor/components/MetricBar';
import { ElectionColors, ELECTION_STATUS_LABELS } from '@/features/election/constants/election.constants';
import { countdownLabel, derivedStatus, totalVotesFor } from '@/features/election/utils/electionFormatters';
import { useActiveElection, useCastVote, useElection, useMyBallot, usePublishResults, useVoterEligibility } from '@/features/election/hooks/useElection';
import { hasEnded } from '@/features/election/utils/electionFormatters';
import type { Candidate, Election, ElectionPosition } from '@/features/election/types/election.types';

export default function ElectionScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const active = useActiveElection();
  const electionId = params.id ?? active.data?.id ?? '';

  const election = useElection(electionId);
  const eligibility = useVoterEligibility(electionId);
  const ballot = useMyBallot(electionId);
  const castVote = useCastVote();
  const publish = usePublishResults();

  const [selected, setSelected] = useState<Record<string, string>>({}); // positionId -> candidateId (pending)

  if (!electionId || election.isLoading || active.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Estate Election" />
        {!electionId && !active.isLoading ? (
          <StateView kind="empty" icon="Vote" title="No active election" message="There is no election open right now. You'll be notified when voting starts." actionLabel="View all elections" onAction={() => router.push('/election/list')} />
        ) : (
          <StateView kind="loading" message="Loading election…" />
        )}
      </SafeAreaView>
    );
  }

  if (election.isError || !election.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Estate Election" />
        <StateView kind="error" title="Couldn't load election" message="Please try again." actionLabel="Retry" onAction={() => election.refetch()} />
      </SafeAreaView>
    );
  }

  const e = election.data;
  const status = derivedStatus(e);
  const isLive = status === 'live';
  // Tallies stay hidden until the admin publishes results — closing alone isn't enough.
  const showResults = status === 'results_published';
  const myChoices = ballot.data?.choices ?? {};
  const votedCount = e.positions.filter((p) => myChoices[p.id]).length;
  const allVoted = votedCount === e.positions.length;
  const eligible = eligibility.data?.eligible ?? true;

  const submit = (position: ElectionPosition) => {
    const candidateId = selected[position.id];
    if (!candidateId) return;
    const candidate = position.candidates.find((c) => c.id === candidateId);
    Alert.alert('Confirm your vote', `Vote ${candidate?.name} for ${position.title}? This can't be changed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Cast vote',
        onPress: () =>
          castVote.mutate(
            { electionId: e.id, positionId: position.id, candidateId },
            { onError: (err) => Alert.alert('Could not vote', err instanceof Error ? err.message : 'Please try again.') },
          ),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Estate Election"
        rightSlot={
          <Pressable onPress={() => router.push('/election/admin/setup')} accessibilityRole="button" accessibilityLabel="Manage elections (admin)" hitSlop={8} style={styles.manageBtn}>
            <Settings2 size={20} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}><Vote size={22} color={Colors.onPrimary} strokeWidth={2} /></View>
            <StatusChip status={status} />
          </View>
          <Text style={styles.heroTitle}>{e.title}</Text>
          {e.description ? <Text style={styles.heroDesc}>{e.description}</Text> : null}
          <View style={styles.heroMeta}>
            <View style={styles.metaItem}>
              <Clock size={14} color={Colors.inversePrimary} strokeWidth={2} />
              <Text style={styles.metaText}>{countdownLabel(e)}</Text>
            </View>
            <View style={styles.metaItem}>
              <Users size={14} color={Colors.inversePrimary} strokeWidth={2} />
              <Text style={styles.metaText}>{e.votesCast}/{e.totalEligibleVoters} voted</Text>
            </View>
          </View>
        </View>

        {/* Eligibility / progress */}
        {!eligible ? (
          <View style={styles.ineligible}>
            <ShieldAlert size={20} color={Colors.error} strokeWidth={2} />
            <Text style={styles.ineligibleText}>{eligibility.data?.reason ?? 'You are not eligible to vote in this election.'}</Text>
          </View>
        ) : isLive && allVoted ? (
          <Pressable onPress={() => router.push(`/election/receipt?id=${e.id}`)} accessibilityRole="button" style={styles.doneBanner}>
            <CheckCircle2 size={20} color={ElectionColors.live} strokeWidth={2} />
            <Text style={styles.doneText}>You've voted in all {e.positions.length} positions. Thank you.</Text>
            <View style={styles.receiptLink}><Receipt size={14} color={ElectionColors.live} strokeWidth={2} /><Text style={styles.receiptText}>Receipt</Text></View>
          </Pressable>
        ) : isLive ? (
          <Text style={styles.progress}>{votedCount} of {e.positions.length} positions voted</Text>
        ) : null}

        {/* Admin: publish results once the election has ended */}
        {hasEnded(e) && !e.resultsPublished ? (
          <View style={styles.publishCard}>
            <Text style={styles.publishTitle}>Voting has closed</Text>
            <Text style={styles.publishSub}>Publish the results to announce them to all residents.</Text>
            <PrimaryButton label="Publish results (admin)" onPress={() => publish.mutate(e.id)} loading={publish.isPending} />
          </View>
        ) : null}

        {/* Positions */}
        {e.positions.map((position) => (
          <PositionCard
            key={position.id}
            electionId={e.id}
            position={position}
            voted={!!myChoices[position.id]}
            votedCandidateId={myChoices[position.id]}
            selectedCandidateId={selected[position.id]}
            onSelect={(cid) => setSelected((s) => ({ ...s, [position.id]: cid }))}
            onSubmit={() => submit(position)}
            submitting={castVote.isPending}
            live={isLive}
            eligible={eligible}
            showResults={showResults}
          />
        ))}

        {showResults ? (
          <Text style={styles.closedNote}>Voting is closed. Final tallies shown above.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusChip({ status }: { status: ReturnType<typeof derivedStatus> }) {
  const color = status === 'live' ? ElectionColors.live : status === 'scheduled' ? ElectionColors.scheduled : ElectionColors.closed;
  const bg = status === 'live' ? ElectionColors.liveBg : status === 'scheduled' ? ElectionColors.scheduledBg : ElectionColors.closedBg;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      {status === 'live' ? <View style={[styles.chipDot, { backgroundColor: color }]} /> : null}
      <Text style={[styles.chipText, { color }]}>{ELECTION_STATUS_LABELS[status]}</Text>
    </View>
  );
}

function PositionCard({
  electionId, position, voted, votedCandidateId, selectedCandidateId, onSelect, onSubmit, submitting, live, eligible, showResults,
}: {
  electionId: string;
  position: ElectionPosition;
  voted: boolean;
  votedCandidateId?: string;
  selectedCandidateId?: string;
  onSelect: (candidateId: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  live: boolean;
  eligible: boolean;
  showResults: boolean;
}) {
  const total = totalVotesFor(position.candidates);
  const max = Math.max(1, ...position.candidates.map((c) => c.votes));

  return (
    <View style={styles.card}>
      <Text style={styles.posTitle}>{position.title}</Text>

      {position.candidates.map((c: Candidate) => {
        if (showResults) {
          return (
            <View key={c.id} style={styles.resultRow}>
              <View style={styles.resultHead}>
                <Text style={styles.candName}>{c.name}</Text>
                <Text style={styles.candPct}>{total ? Math.round((c.votes / total) * 100) : 0}%</Text>
              </View>
              <MetricBar label="" value={c.votes} max={max} color={Colors.primary} />
            </View>
          );
        }
        const isVotedChoice = voted && votedCandidateId === c.id;
        const isSelected = !voted && selectedCandidateId === c.id;
        const selectable = live && eligible && !voted;
        return (
          <View key={c.id} style={[styles.candRow, (isSelected || isVotedChoice) && styles.candRowSelected]}>
            <Pressable
              onPress={() => selectable && onSelect(c.id)}
              disabled={!selectable}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected || isVotedChoice }}
              style={styles.candSelect}
            >
              {isVotedChoice
                ? <CheckCircle2 size={20} color={ElectionColors.live} strokeWidth={2} />
                : isSelected
                  ? <CheckCircle2 size={20} color={Colors.primary} strokeWidth={2} />
                  : <Circle size={20} color={Colors.outline} strokeWidth={2} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.candName}>{c.name}</Text>
                {c.manifesto ? <Text style={styles.candManifesto} numberOfLines={2}>{c.manifesto}</Text> : null}
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.push(`/election/candidate/${c.id}?electionId=${electionId}`)}
              accessibilityRole="button"
              accessibilityLabel={`View ${c.name}'s profile`}
              hitSlop={8}
              style={styles.candInfo}
            >
              <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>
          </View>
        );
      })}

      {voted ? (
        <View style={styles.votedTag}>
          <CheckCircle2 size={14} color={ElectionColors.live} strokeWidth={2} />
          <Text style={styles.votedTagText}>Voted</Text>
        </View>
      ) : live && eligible && !showResults ? (
        <PrimaryButton label="Cast vote" onPress={onSubmit} loading={submitting} disabled={!selectedCandidateId} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, ...shadow1 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.headlineMd, color: Colors.onPrimary },
  heroDesc: { ...Typography.bodySm, color: Colors.inversePrimary },
  heroMeta: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.xs },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { ...Typography.labelSm, color: Colors.inverseOnSurface },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { ...Typography.labelSm, fontWeight: '800' },
  ineligible: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  ineligibleText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  doneBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: ElectionColors.liveBg, borderRadius: Radius.lg, padding: Spacing.md },
  doneText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  progress: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  publishCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm, ...shadow1 },
  publishTitle: { ...Typography.labelLg, color: Colors.onSurface },
  publishSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm, ...shadow1 },
  posTitle: { ...Typography.titleMd, color: Colors.onSurface },
  candRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow },
  candRowSelected: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  candSelect: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  candInfo: { padding: 4 },
  manageBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  receiptLink: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  receiptText: { ...Typography.labelSm, color: ElectionColors.live, fontWeight: '700' },
  candName: { ...Typography.labelMd, color: Colors.onSurface },
  candManifesto: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  candPct: { ...Typography.labelMd, color: Colors.primary },
  resultRow: { gap: 2, paddingVertical: 4 },
  resultHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  votedTag: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: ElectionColors.liveBg, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  votedTagText: { ...Typography.labelSm, color: ElectionColors.live, fontWeight: '700' },
  closedNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
});
