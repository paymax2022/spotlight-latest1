import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Circle, Lock, ShieldCheck, Trophy, Info, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useElection, useCastVote } from '@/features/association/hooks/useAssociation';
import type { ElectionPosition, PositionResult, VoteReceipt } from '@/features/association/types/association.types';

export default function ElectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const election = useElection(id);
  const cast = useCastVote(id);

  const [selected, setSelected] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});
  const [receipts, setReceipts] = useState<Record<string, VoteReceipt>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const d = election.data;
  const votingOpen = d?.status === 'VOTING';

  const doCast = (position: ElectionPosition) => {
    const candidateId = selected[position.id];
    if (!candidateId) return;
    cast.mutate(
      { positionId: position.id, candidateId },
      {
        onSuccess: (r) => {
          setReceipts((prev) => ({ ...prev, [position.id]: r }));
          setConfirming((prev) => ({ ...prev, [position.id]: false }));
          setErrors((prev) => ({ ...prev, [position.id]: '' }));
        },
        onError: () => setErrors((prev) => ({ ...prev, [position.id]: 'Your vote could not be recorded. Please try again.' })),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Election" />
      {election.isLoading ? (
        <StateView kind="loading" message="Loading ballot…" />
      ) : election.isError || !d ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => election.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>{d.title}</Text>
          {!!d.description && <Text style={styles.desc}>{d.description}</Text>}

          {/* Eligibility */}
          {!d.eligible && (
            <View style={[styles.banner, styles.bannerBad]}>
              <Lock size={16} color={Colors.error} strokeWidth={2} />
              <Text style={styles.bannerText}>{d.eligibilityReason || 'You are not eligible to vote in this election.'}</Text>
            </View>
          )}
          {d.eligible && votingOpen && (
            <View style={[styles.banner, styles.bannerOk]}>
              <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.bannerText}>You are eligible. One vote per position — your choice stays secret.</Text>
            </View>
          )}

          {/* Positions */}
          {d.positions.map((p) => {
            const published = d.status === 'PUBLISHED';
            const result = published ? d.results?.find((r) => r.positionId === p.id) : undefined;
            const voted = p.hasVoted || !!receipts[p.id];
            const selectedName = p.candidates.find((c) => c.id === selected[p.id])?.name;
            return (
              <View key={p.id} style={[styles.posCard, shadow1]}>
                <View style={styles.posHeader}>
                  <Text style={styles.posTitle}>{p.title}</Text>
                  <Text style={styles.posSeats}>{p.seats} seat{p.seats === 1 ? '' : 's'}</Text>
                </View>

                {result ? (
                  <ResultList result={result} />
                ) : voted ? (
                  <View style={styles.votedBox}>
                    <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.votedTitle}>Your vote is recorded</Text>
                      <Text style={styles.votedSub}>Your ballot is secret.{receipts[p.id] ? ` Receipt ${receipts[p.id].receipt}` : ''}</Text>
                    </View>
                  </View>
                ) : (
                  <>
                    {p.candidates.map((c) => {
                      const isSel = selected[p.id] === c.id;
                      const disabled = !votingOpen || !d.eligible || confirming[p.id];
                      return (
                        <Pressable
                          key={c.id}
                          style={[styles.candidate, isSel && styles.candidateSel]}
                          onPress={() => !disabled && setSelected((prev) => ({ ...prev, [p.id]: c.id }))}
                          disabled={disabled}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: isSel, disabled }}
                          accessibilityLabel={`${c.name} for ${p.title}`}
                        >
                          {isSel
                            ? <CheckCircle2 size={20} color={Colors.primary} strokeWidth={2} />
                            : <Circle size={20} color={Colors.outline} strokeWidth={2} />}
                          <View style={{ flex: 1 }}>
                            <Text style={styles.candName}>{c.name}</Text>
                            {!!c.manifesto && <Text style={styles.manifesto}>{c.manifesto}</Text>}
                          </View>
                        </Pressable>
                      );
                    })}

                    {!!errors[p.id] && (
                      <View style={styles.errRow}>
                        <AlertTriangle size={14} color={Colors.error} strokeWidth={2} />
                        <Text style={styles.errText}>{errors[p.id]}</Text>
                      </View>
                    )}

                    {votingOpen && d.eligible ? (
                      confirming[p.id] ? (
                        <View style={styles.confirmBox}>
                          <Text style={styles.confirmText}>
                            Cast your vote for <Text style={styles.confirmName}>{selectedName}</Text> as {p.title}? This is final and your ballot stays secret.
                          </Text>
                          <View style={styles.confirmActions}>
                            <PrimaryButton label="Cancel" variant="secondary" onPress={() => setConfirming((prev) => ({ ...prev, [p.id]: false }))} style={styles.confirmBtn} fullWidth={false} />
                            <PrimaryButton label="Confirm vote" onPress={() => doCast(p)} loading={cast.isPending} disabled={cast.isPending} style={styles.confirmBtn} fullWidth={false} />
                          </View>
                        </View>
                      ) : (
                        <PrimaryButton
                          label="Cast vote"
                          onPress={() => setConfirming((prev) => ({ ...prev, [p.id]: true }))}
                          disabled={!selected[p.id]}
                        />
                      )
                    ) : (
                      <View style={styles.closedNote}>
                        <Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                        <Text style={styles.closedNoteText}>
                          {!d.eligible ? 'Voting is unavailable while your membership is not in good standing.' : 'Voting is not open for this election.'}
                        </Text>
                      </View>
                    )}
                  </>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ResultList({ result }: { result: PositionResult }) {
  const max = Math.max(1, ...result.results.map((r) => r.votes));
  return (
    <View style={{ gap: Spacing.sm }}>
      {result.results.map((r) => (
        <View key={r.candidateId} style={styles.resultRow}>
          <View style={styles.resultHead}>
            <Text style={styles.resultName} numberOfLines={1}>
              {r.name} {r.isWinner ? <Trophy size={13} color={Colors.gold} /> : null}
            </Text>
            <Text style={styles.resultVotes}>{r.votes}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${(r.votes / max) * 100}%` }, r.isWinner && styles.barWinner]} />
          </View>
        </View>
      ))}
      <Text style={styles.resultMeta}>{result.ballotsCast} ballot{result.ballotsCast === 1 ? '' : 's'} cast · results verified &amp; sealed</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md },
  bannerOk: { backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.teal },
  bannerBad: { backgroundColor: Colors.errorContainer },
  bannerText: { ...Typography.labelSm, color: Colors.onSurface, flex: 1 },
  posCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  posHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  posTitle: { ...Typography.titleMd, color: Colors.onSurface },
  posSeats: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  candidate: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  candidateSel: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  candName: { ...Typography.labelLg, color: Colors.onSurface },
  manifesto: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  votedBox: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, padding: Spacing.sm },
  votedTitle: { ...Typography.labelLg, color: Colors.onSurface },
  votedSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  confirmBox: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  confirmText: { ...Typography.bodySm, color: Colors.onSurface },
  confirmName: { ...Typography.labelLg, color: Colors.onSurface },
  confirmActions: { flexDirection: 'row', gap: Spacing.sm },
  confirmBtn: { flex: 1 },
  closedNote: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center' },
  closedNoteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  errRow: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center' },
  errText: { ...Typography.labelSm, color: Colors.error, flex: 1 },
  resultRow: { gap: 4 },
  resultHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultName: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  resultVotes: { ...Typography.labelLg, color: Colors.onSurface },
  barTrack: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  barWinner: { backgroundColor: Colors.teal },
  resultMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
