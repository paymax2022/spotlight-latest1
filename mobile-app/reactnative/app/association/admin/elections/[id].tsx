import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { UserPlus, X } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { confirmAsync } from '@/lib/confirm';
import {
  useAddElectionCandidate, useCloseElection, useDirectory, useElection,
  useOpenElection, usePublishElectionResults,
} from '@/features/association/hooks';
import type { ElectionDetail, ElectionPosition } from '@/features/association/types/association.types';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  NOMINATION: 'Nominations',
  VOTING: 'Voting open',
  CLOSED: 'Voting closed',
  PUBLISHED: 'Results published',
  CANCELLED: 'Cancelled',
};

// Officer console for one election. Each action is only offered in the status
// the server accepts it from; the server still enforces every transition.
export default function AdminElectionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const election = useElection(id);

  if (election.isLoading) return <Shell title="Election"><StateView kind="loading" message="Loading election…" /></Shell>;
  if (election.isError || !election.data) {
    return (
      <Shell title="Election">
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => election.refetch()} />
      </Shell>
    );
  }
  return <ElectionConsole key={id} electionId={id} election={election.data} />;
}

function ElectionConsole({ electionId, election }: { electionId: string; election: ElectionDetail }) {
  const open = useOpenElection(electionId);
  const close = useCloseElection(electionId);
  const publish = usePublishElectionResults(electionId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);

  const acceptsCandidates = election.status === 'DRAFT' || election.status === 'NOMINATION';
  const busy = open.isPending || close.isPending || publish.isPending;

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(messageOf(e));
    }
  };

  const onClose = async () => {
    const ok = await confirmAsync({
      title: 'Close voting?',
      message: 'No further votes can be cast once voting is closed.',
      confirmLabel: 'Close voting',
      destructive: true,
    });
    if (ok) run(() => close.mutateAsync());
  };

  const onPublish = async () => {
    const ok = await confirmAsync({
      title: 'Publish results?',
      message: 'Results become visible to all members. This cannot be undone.',
      confirmLabel: 'Publish results',
    });
    if (ok) run(() => publish.mutateAsync());
  };

  return (
    <Shell title={election.title}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.statusRow}>
          <Text style={styles.statusPill}>{STATUS_LABEL[election.status] ?? election.status}</Text>
        </View>
        {election.description ? <Text style={styles.description}>{election.description}</Text> : null}

        <Text style={styles.sectionLabel}>Ballot</Text>
        {election.positions.map((p) => (
          <PositionBlock
            key={p.id}
            electionId={electionId}
            position={p}
            canAddCandidates={acceptsCandidates}
            picking={pickingFor === p.id}
            onTogglePick={() => setPickingFor(pickingFor === p.id ? null : p.id)}
          />
        ))}

        <Text style={styles.sectionLabel}>Next step</Text>
        {acceptsCandidates ? (
          <PrimaryButton label="Open voting" onPress={() => run(() => open.mutateAsync())} loading={open.isPending} disabled={busy} />
        ) : null}
        {election.status === 'VOTING' ? (
          <PrimaryButton label="Close voting" variant="danger" onPress={onClose} loading={close.isPending} disabled={busy} />
        ) : null}
        {election.status === 'CLOSED' ? (
          <PrimaryButton label="Publish results" onPress={onPublish} loading={publish.isPending} disabled={busy} />
        ) : null}
        {election.status === 'PUBLISHED' ? (
          <PrimaryButton label="View results" variant="secondary" onPress={() => router.push(`/association/elections/${electionId}`)} disabled={busy} />
        ) : null}

        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      </ScrollView>
    </Shell>
  );
}

function PositionBlock({
  electionId, position, canAddCandidates, picking, onTogglePick,
}: {
  electionId: string;
  position: ElectionPosition;
  canAddCandidates: boolean;
  picking: boolean;
  onTogglePick: () => void;
}) {
  return (
    <View style={styles.positionCard}>
      <View style={styles.positionHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.positionTitle}>{position.title}</Text>
          <Text style={styles.positionMeta}>{position.seats} seat{position.seats === 1 ? '' : 's'} · {position.candidates.length} candidate{position.candidates.length === 1 ? '' : 's'}</Text>
        </View>
        {canAddCandidates ? (
          <Pressable onPress={onTogglePick} hitSlop={8} style={styles.pickToggle} accessibilityRole="button" accessibilityLabel={picking ? 'Close member picker' : `Add candidate to ${position.title}`}>
            {picking ? <X size={16} color={Colors.primary} strokeWidth={2} /> : <UserPlus size={16} color={Colors.primary} strokeWidth={2} />}
            <Text style={styles.pickToggleText}>{picking ? 'Done' : 'Add'}</Text>
          </Pressable>
        ) : null}
      </View>

      {position.candidates.map((c) => (
        <Text key={c.id} style={styles.candidate}>{c.name}</Text>
      ))}
      {!position.candidates.length ? <Text style={styles.positionMeta}>No candidates yet.</Text> : null}

      {picking ? <MemberPicker electionId={electionId} positionId={position.id} /> : null}
    </View>
  );
}

// Mounted only while a position's picker is open, so the directory is not
// fetched for every election the officer views.
function MemberPicker({ electionId, positionId }: { electionId: string; positionId: string }) {
  const [search, setSearch] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const directory = useDirectory({ status: 'ACTIVE', search: search.trim() || undefined });
  const addCandidate = useAddElectionCandidate(electionId);

  const pick = async (membershipId: string, name: string) => {
    setError(null);
    setAdded(null);
    try {
      await addCandidate.mutateAsync({ positionId, membershipId });
      setAdded(name);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  return (
    <View style={styles.picker}>
      <TextInputField placeholder="Search active members" value={search} onChangeText={setSearch} maxLength={80} />
      {added ? <Text style={styles.added}>Added {added}.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {directory.isLoading ? <ActivityIndicator color={Colors.primary} /> : null}
      {directory.data?.map((m) => (
        <Pressable
          key={m.id}
          onPress={() => pick(m.id, m.fullName)}
          disabled={addCandidate.isPending}
          style={styles.memberRow}
          accessibilityRole="button"
          accessibilityLabel={`Add ${m.fullName} as a candidate`}
        >
          <Text style={styles.memberName}>{m.fullName}</Text>
          <Text style={styles.positionMeta}>{m.memberId}</Text>
        </Pressable>
      ))}
      {directory.data && !directory.data.length ? <Text style={styles.positionMeta}>No active members match.</Text> : null}
    </View>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} backFallback="/association/admin/elections" />
      {children}
    </SafeAreaView>
  );
}

function messageOf(e: unknown): string {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data;
  if (data?.error) return data.error;
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  scroll: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  statusRow: { flexDirection: 'row' },
  statusPill: { ...Typography.labelSm, color: Colors.primary, backgroundColor: Colors.iconBgPurple, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full ?? 999, overflow: 'hidden' },
  description: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  sectionLabel: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  positionCard: { gap: Spacing.xs, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  positionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  positionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  positionMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  pickToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full ?? 999, borderWidth: 1, borderColor: Colors.primary },
  pickToggleText: { ...Typography.labelSm, color: Colors.primary },
  candidate: { ...Typography.bodySm, color: Colors.onSurface },
  picker: { gap: Spacing.xs, marginTop: Spacing.xs },
  memberRow: { paddingVertical: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  memberName: { ...Typography.labelLg, color: Colors.onSurface },
  added: { ...Typography.labelSm, color: Colors.primary },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
});
