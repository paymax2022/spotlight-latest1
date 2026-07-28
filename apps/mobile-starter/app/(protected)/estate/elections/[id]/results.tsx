// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const AVATAR_COLORS = ['#340075', '#0051d5', '#059669', '#f59e0b', '#dc2626', '#7c3aed'];
function getAvatarColor(name: string) {
  const idx = (name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}
function initials(name: string) {
  return (name ?? '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export default function ElectionResults() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/estate/elections/${id}/results`)
      .then(r => r.json())
      .then(d => setResults(d.data ?? d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (error || !results) {
    return (
      <SafeAreaView style={s.center}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.secondary.red} />
        <Text style={s.errorText}>{error ?? 'Results not available'}</Text>
        <Pressable style={s.ghostBtn} onPress={() => router.back()}>
          <Text style={s.ghostBtnText}>Go Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const positions = results.positions ?? [];
  const totalVotes = results.total_votes ?? 0;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>Official Results</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.totalVotesCard}>
          <Ionicons name="stats-chart-outline" size={20} color={colors.primary.DEFAULT} />
          <Text style={s.totalVotesText}>Total Votes Cast: <Text style={s.totalVotesBold}>{totalVotes}</Text></Text>
        </View>

        {positions.map(pos => {
          const maxVotes = Math.max(...(pos.candidates?.map(c => c.votes) ?? [1]), 1);
          const winner = pos.candidates?.reduce((a, b) => (b.votes > a.votes ? b : a), pos.candidates[0]);
          return (
            <View key={pos.name} style={s.posSection}>
              <Text style={s.posTitle}>{pos.name}</Text>
              {pos.candidates?.map(c => {
                const isWinner = c.id === winner?.id;
                const pct = totalVotes > 0 ? Math.round((c.votes / totalVotes) * 100) : 0;
                return (
                  <View key={c.id} style={[s.candidateRow, isWinner && s.candidateRowWinner]}>
                    <View style={[s.avatar, { backgroundColor: getAvatarColor(c.name) }]}>
                      <Text style={s.avatarText}>{initials(c.name)}</Text>
                    </View>
                    <View style={s.candidateInfo}>
                      <View style={s.nameRow}>
                        <Text style={s.candidateName}>{c.name}</Text>
                        {isWinner && (
                          <View style={s.winnerBadge}>
                            <Ionicons name="trophy" size={12} color={colors.gold.DEFAULT} />
                            <Text style={s.winnerBadgeText}>Winner</Text>
                          </View>
                        )}
                      </View>
                      <View style={s.barTrack}>
                        <View style={[s.barFill, { width: `${(c.votes / maxVotes) * 100}%`, backgroundColor: isWinner ? colors.secondary.emerald : colors.neutral.border }]} />
                      </View>
                      <Text style={s.voteCount}>{c.votes} votes ({pct}%)</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutral.background, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  body: { padding: 16, paddingBottom: 40 },
  totalVotesCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 20 },
  totalVotesText: { fontSize: 14, color: colors.neutral.textMuted },
  totalVotesBold: { color: colors.neutral.text, fontWeight: '700' },
  posSection: { marginBottom: 24 },
  posTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, marginBottom: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  candidateRow: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.neutral.border },
  candidateRowWinner: { borderColor: colors.gold.DEFAULT, backgroundColor: '#fffdf5' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  candidateInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  candidateName: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  winnerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  winnerBadgeText: { fontSize: 11, color: '#92400e', fontWeight: '700' },
  barTrack: { height: 8, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
  barFill: { height: 8, borderRadius: 4 },
  voteCount: { fontSize: 12, color: colors.neutral.textMuted },
  errorText: { fontSize: 15, color: colors.neutral.text, marginTop: 12, marginBottom: 20, textAlign: 'center' },
  ghostBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, borderWidth: 1, borderColor: colors.neutral.border },
  ghostBtnText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
});
