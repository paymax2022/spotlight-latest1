// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { castVote, getElectionResults, listElections } from '@/api/estate.api';
import type { Candidate, Election, ElectionResult } from '@/api/estate.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8',
  open: '#00B894',
  closed: '#F39C12',
  tallied: '#6C5CE7',
};

type PanelState =
  | { kind: 'list' }
  | { kind: 'vote'; election: Election }
  | { kind: 'results'; election: Election; results: ElectionResult[] };

function ElectionCard({
  election,
  onVote,
  onResults,
}: {
  election: Election;
  onVote: (e: Election) => void;
  onResults: (e: Election) => void;
}) {
  const color = STATUS_COLOR[election.status] ?? '#94a3b8';
  const isOpen = election.status === 'open';
  const isTallied = election.status === 'tallied' || election.status === 'closed';

  return (
    <View style={styles.elCard}>
      <View style={styles.elTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.elTitle}>{election.title}</Text>
          {election.description ? (
            <Text style={styles.elDesc} numberOfLines={2}>{election.description}</Text>
          ) : null}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: color + '20' }]}>
          <Text style={[styles.statusText, { color }]}>{election.status}</Text>
        </View>
      </View>

      <View style={styles.elMeta}>
        <View style={styles.metaItem}>
          <Ionicons name="calendar-outline" size={13} color={colors.neutral.textMuted} />
          <Text style={styles.metaText}>
            {new Date(election.starts_at).toLocaleDateString()} – {new Date(election.ends_at).toLocaleDateString()}
          </Text>
        </View>
        {election.candidates && (
          <View style={styles.metaItem}>
            <Ionicons name="people-outline" size={13} color={colors.neutral.textMuted} />
            <Text style={styles.metaText}>{election.candidates.length} candidates</Text>
          </View>
        )}
      </View>

      <View style={styles.elActions}>
        {isOpen && (
          <Pressable style={styles.voteBtn} onPress={() => onVote(election)}>
            <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
            <Text style={styles.voteBtnText}>Cast Vote</Text>
          </Pressable>
        )}
        {isTallied && (
          <Pressable style={styles.resultsBtn} onPress={() => onResults(election)}>
            <Ionicons name="bar-chart-outline" size={16} color={colors.secondary.DEFAULT} />
            <Text style={styles.resultsBtnText}>View Results</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function VotePanel({
  estateId,
  election,
  onBack,
  onSuccess,
}: {
  estateId: string;
  election: Election;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const voteMutation = useMutation({
    mutationFn: () => castVote(estateId, election.id, selected!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estate-elections', estateId] });
      onSuccess();
    },
    onError: (err: { response?: { status?: number; data?: { error?: string } } }) => {
      const msg = err?.response?.data?.error ?? '';
      if (err?.response?.status === 409 || msg.toLowerCase().includes('already')) {
        setError('You have already voted in this election.');
      } else {
        setError(msg || 'Vote failed. Please try again.');
      }
    },
  });

  const candidates: Candidate[] = election.candidates ?? [];

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Pressable style={styles.panelBack} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color={colors.neutral.text} />
        </Pressable>
        <Text style={styles.panelTitle}>{election.title}</Text>
      </View>

      <Text style={styles.panelSub}>Select a candidate and cast your vote</Text>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={16} color="#dc2626" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {candidates.map((c) => (
        <Pressable
          key={c.id}
          style={[styles.candidateRow, selected === c.id && styles.candidateRowActive]}
          onPress={() => setSelected(c.id)}
        >
          <View style={[styles.candidateAvatar, selected === c.id && { backgroundColor: colors.primary.DEFAULT }]}>
            <Ionicons name="person" size={20} color={selected === c.id ? '#fff' : colors.neutral.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.candidateName, selected === c.id && { color: colors.primary.DEFAULT }]}>
              {c.name}
            </Text>
            {c.bio ? <Text style={styles.candidateBio} numberOfLines={2}>{c.bio}</Text> : null}
          </View>
          {selected === c.id && (
            <Ionicons name="checkmark-circle" size={22} color={colors.primary.DEFAULT} />
          )}
        </Pressable>
      ))}

      <Pressable
        style={[
          styles.primaryBtn,
          (!selected || voteMutation.isPending) && styles.primaryBtnDisabled,
        ]}
        disabled={!selected || voteMutation.isPending}
        onPress={() => { setError(null); voteMutation.mutate(); }}
      >
        {voteMutation.isPending
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.primaryBtnText}>Confirm Vote</Text>
        }
      </Pressable>
    </View>
  );
}

function ResultsPanel({
  election,
  results,
  onBack,
}: {
  election: Election;
  results: ElectionResult[];
  onBack: () => void;
}) {
  const total = results.reduce((sum, r) => sum + r.votes, 0);

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Pressable style={styles.panelBack} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color={colors.neutral.text} />
        </Pressable>
        <Text style={styles.panelTitle}>Results: {election.title}</Text>
      </View>

      <Text style={styles.panelSub}>
        {total} total vote{total !== 1 ? 's' : ''}
      </Text>

      {results
        .sort((a, b) => b.votes - a.votes)
        .map((r, idx) => {
          const pct = total > 0 ? Math.round((r.votes / total) * 100) : 0;
          return (
            <View key={r.candidate_id} style={styles.resultRow}>
              <View style={styles.resultMeta}>
                {idx === 0 && total > 0 && (
                  <Ionicons name="trophy" size={16} color={colors.gold?.DEFAULT ?? '#C5A059'} style={{ marginRight: 4 }} />
                )}
                <Text style={styles.resultName}>{r.name}</Text>
                <Text style={styles.resultVotes}>{r.votes} vote{r.votes !== 1 ? 's' : ''}</Text>
              </View>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: idx === 0 ? colors.primary.DEFAULT : colors.neutral.placeholder }]} />
              </View>
              <Text style={styles.resultPct}>{pct}%</Text>
            </View>
          );
        })}
    </View>
  );
}

export default function ElectionsScreen() {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelState>({ kind: 'list' });
  const [voteSuccess, setVoteSuccess] = useState(false);

  const activeContext = useQuery({
    queryKey: ['active-estate-context'],
    queryFn: getActiveEstateContext,
  });
  const estateId = activeContext.data?.estateId;

  const elections = useQuery({
    queryKey: ['estate-elections', estateId],
    queryFn: () => listElections(estateId!),
    enabled: Boolean(estateId),
    retry: false,
  });

  const handleViewResults = async (election: Election) => {
    if (!estateId) {
      router.push('/estate/switcher' as never);
      return;
    }
    try {
      const results = await getElectionResults(estateId, election.id);
      setPanel({ kind: 'results', election, results });
    } catch {
      setPanel({ kind: 'results', election, results: [] });
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => {
            if (panel.kind !== 'list') { setPanel({ kind: 'list' }); setVoteSuccess(false); }
            else router.back();
          }}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Estate Elections</Text>
        <View style={{ width: 38 }} />
      </View>

      {panel.kind === 'vote' && !voteSuccess && (
        <VotePanel
          estateId={estateId!}
          election={panel.election}
          onBack={() => setPanel({ kind: 'list' })}
          onSuccess={() => setVoteSuccess(true)}
        />
      )}

      {panel.kind === 'vote' && voteSuccess && (
        <View style={styles.successContainer}>
          <Ionicons name="checkmark-circle" size={72} color="#00B894" />
          <Text style={styles.successTitle}>Vote Cast!</Text>
          <Text style={styles.successSub}>Your vote has been recorded anonymously.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => { setPanel({ kind: 'list' }); setVoteSuccess(false); }}>
            <Text style={styles.primaryBtnText}>Back to Elections</Text>
          </Pressable>
        </View>
      )}

      {panel.kind === 'results' && (
        <ScrollView contentContainerStyle={styles.content}>
          <ResultsPanel
            election={panel.election}
            results={panel.results}
            onBack={() => setPanel({ kind: 'list' })}
          />
        </ScrollView>
      )}

      {panel.kind === 'list' && (
        activeContext.isLoading || elections.isLoading ? (
          <AppLoader />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl refreshing={elections.isRefetching} onRefresh={elections.refetch} />
            }
          >
            {(elections.data ?? []).length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="podium-outline" size={56} color={colors.neutral.placeholder} />
                <Text style={styles.emptyTitle}>
                  {estateId ? 'No elections yet' : 'Choose an estate first'}
                </Text>
                <Text style={styles.emptySub}>
                  {estateId
                    ? 'Elections created by estate admin will appear here'
                    : 'Select an estate to view elections and voting eligibility'}
                </Text>
                {!estateId && (
                  <Pressable
                    style={styles.primaryBtn}
                    onPress={() => router.push('/estate/switcher' as never)}
                  >
                    <Text style={styles.primaryBtnText}>Switch Estate</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              (elections.data ?? []).map((el) => (
                <ElectionCard
                  key={el.id}
                  election={el}
                  onVote={(e) => setPanel({ kind: 'vote', election: e })}
                  onResults={handleViewResults}
                />
              ))
            )}
          </ScrollView>
        )
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },

  content: { padding: 16, gap: 12, paddingBottom: 40 },

  // Election card
  elCard: {
    backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  elTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  elTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  elDesc: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  elMeta: { gap: 4, marginBottom: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: colors.neutral.textMuted },
  elActions: { flexDirection: 'row', gap: 10 },
  voteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 10,
  },
  voteBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  resultsBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.secondary.DEFAULT + '15', borderRadius: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.secondary.DEFAULT + '30',
  },
  resultsBtnText: { color: colors.secondary.DEFAULT, fontWeight: '700', fontSize: 14 },

  // Inline panels (vote + results)
  panel: { padding: 20, gap: 14 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  panelBack: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  panelTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.neutral.text },
  panelSub: { fontSize: 13, color: colors.neutral.textMuted, marginBottom: 8 },

  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10,
  },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },

  candidateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    backgroundColor: colors.neutral.surface, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.neutral.border,
  },
  candidateRowActive: { borderColor: colors.primary.DEFAULT, backgroundColor: colors.primary.DEFAULT + '08' },
  candidateAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  candidateName: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  candidateBio: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },

  primaryBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Results
  resultRow: { marginBottom: 16 },
  resultMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  resultName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  resultVotes: { fontSize: 13, color: colors.neutral.textMuted },
  progressBar: {
    height: 8, backgroundColor: colors.neutral.border, borderRadius: 4, overflow: 'hidden', marginBottom: 4,
  },
  progressFill: { height: '100%', borderRadius: 4 },
  resultPct: { fontSize: 12, fontWeight: '700', color: colors.neutral.textMuted },

  // Success
  successContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14,
  },
  successTitle: { fontSize: 26, fontWeight: '800', color: colors.neutral.text },
  successSub: { fontSize: 15, color: colors.neutral.textMuted, textAlign: 'center' },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 64, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.neutral.text },
  emptySub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', maxWidth: 260 },
});
