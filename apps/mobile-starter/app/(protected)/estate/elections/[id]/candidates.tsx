// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function CandidateList() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [candidates, setCandidates] = useState([]);
  const [positions, setPositions] = useState([]);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [electionOpen, setElectionOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/estate/elections/${id}/candidates`).then(r => r.json()),
      fetch(`/api/estate/elections/${id}`).then(r => r.json()),
    ])
      .then(([cData, eData]) => {
        const list = cData.data ?? cData ?? [];
        setCandidates(list);
        const pos = ['All', ...Array.from(new Set(list.map(c => c.position).filter(Boolean)))];
        setPositions(pos);
        setElectionOpen((eData.data ?? eData)?.status === 'open');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const filtered = filter === 'All' ? candidates : candidates.filter(c => c.position === filter);

  const grouped = filtered.reduce((acc, c) => {
    const pos = c.position ?? 'General';
    if (!acc[pos]) acc[pos] = [];
    acc[pos].push(c);
    return acc;
  }, {});

  const sections = Object.entries(grouped);

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>Candidates</Text>
        <View style={{ width: 38 }} />
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterBar}>
          {positions.map(pos => (
            <Pressable
              key={pos}
              style={[s.chip, filter === pos && s.chipActive]}
              onPress={() => setFilter(pos)}
            >
              <Text style={[s.chipText, filter === pos && s.chipTextActive]}>{pos}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : sections.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="people-outline" size={48} color={colors.neutral.placeholder} />
          <Text style={s.emptyText}>No candidates found</Text>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={([pos]) => pos}
          contentContainerStyle={s.listBody}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: [pos, list] }) => (
            <View>
              <View style={s.posHeader}>
                <Text style={s.posTitle}>{pos}</Text>
                <Text style={s.posCount}>{list.length} candidate{list.length !== 1 ? 's' : ''}</Text>
              </View>
              {list.map(candidate => (
                <View key={candidate.id} style={s.candidateCard}>
                  <View style={[s.avatar, { backgroundColor: getAvatarColor(candidate.name) }]}>
                    <Text style={s.avatarText}>{initials(candidate.name)}</Text>
                  </View>
                  <View style={s.cardContent}>
                    <Text style={s.candidateName}>{candidate.name}</Text>
                    <Text style={s.manifesto} numberOfLines={2}>{candidate.manifesto ?? 'No manifesto provided.'}</Text>
                    <View style={s.cardActions}>
                      <Pressable
                        style={s.profileBtn}
                        onPress={() => router.push(`/estate/elections/${id}/candidate/${candidate.id}` as never)}
                      >
                        <Text style={s.profileBtnText}>View Full Profile</Text>
                      </Pressable>
                      {electionOpen && (
                        <Pressable
                          style={s.voteBtn}
                          onPress={() => router.push(`/estate/elections/${id}/vote` as never)}
                        >
                          <Text style={s.voteBtnText}>Vote</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  filterBar: { paddingHorizontal: 16, paddingVertical: 12, gap: 8, flexDirection: 'row' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1, borderColor: colors.neutral.border },
  chipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  chipText: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  listBody: { paddingHorizontal: 16, paddingBottom: 40 },
  posHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 10 },
  posTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  posCount: { fontSize: 12, color: colors.neutral.textMuted },
  candidateCard: { flexDirection: 'row', backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.neutral.border },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  cardContent: { flex: 1 },
  candidateName: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, marginBottom: 4 },
  manifesto: { fontSize: 13, color: colors.neutral.textMuted, lineHeight: 19, marginBottom: 10 },
  cardActions: { flexDirection: 'row', gap: 8 },
  profileBtn: { borderWidth: 1, borderColor: colors.primary.DEFAULT, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  profileBtnText: { fontSize: 12, color: colors.primary.DEFAULT, fontWeight: '600' },
  voteBtn: { backgroundColor: colors.secondary.emerald, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  voteBtnText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  errorText: { fontSize: 14, color: colors.secondary.red, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted, marginTop: 12 },
});
