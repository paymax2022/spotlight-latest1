// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const STATUS_CONFIG = {
  open:    { label: 'Open',    bg: '#d1fae5', text: '#065f46' },
  closed:  { label: 'Closed', bg: '#fef3c7', text: '#92400e' },
  tallied: { label: 'Tallied',bg: '#ede9fe', text: '#5b21b6' },
  draft:   { label: 'Draft',  bg: '#f1f5f9', text: '#475569' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <View style={[s.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[s.badgeText, { color: cfg.text }]}>{cfg.label}</Text>
    </View>
  );
}

export default function ElectionDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [election, setElection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/estate/elections/${id}`)
      .then(r => r.json())
      .then(d => setElection(d.data ?? d))
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

  if (error || !election) {
    return (
      <SafeAreaView style={s.center}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.secondary.red} />
        <Text style={s.errorText}>{error ?? 'Election not found'}</Text>
        <Pressable style={s.ghostBtn} onPress={() => router.back()}>
          <Text style={s.ghostBtnText}>Go Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const status = election.status ?? 'draft';

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle} numberOfLines={1}>Election Details</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.titleRow}>
          <Text style={s.electionTitle}>{election.title}</Text>
          <StatusBadge status={status} />
        </View>

        <Text style={s.description}>{election.description}</Text>

        <View style={s.card}>
          <View style={s.dateRow}>
            <Ionicons name="calendar-outline" size={16} color={colors.neutral.textMuted} />
            <Text style={s.dateLabel}>Start:</Text>
            <Text style={s.dateValue}>{election.start_date ? new Date(election.start_date).toLocaleString() : 'TBD'}</Text>
          </View>
          <View style={[s.dateRow, { marginTop: 6 }]}>
            <Ionicons name="calendar-outline" size={16} color={colors.neutral.textMuted} />
            <Text style={s.dateLabel}>End:</Text>
            <Text style={s.dateValue}>{election.end_date ? new Date(election.end_date).toLocaleString() : 'TBD'}</Text>
          </View>
        </View>

        <View style={s.statsRow}>
          <View style={s.statBox}>
            <Text style={s.statNum}>{election.candidates_count ?? '--'}</Text>
            <Text style={s.statLabel}>Candidates</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statNum}>{election.registered_voters ?? '--'}</Text>
            <Text style={s.statLabel}>Reg. Voters</Text>
          </View>
          {election.public_results && (
            <View style={s.statBox}>
              <Text style={s.statNum}>{election.votes_cast ?? '--'}</Text>
              <Text style={s.statLabel}>Votes Cast</Text>
            </View>
          )}
        </View>

        {election.dues_owed && (
          <View style={s.warningCard}>
            <Ionicons name="warning" size={20} color={colors.secondary.red} />
            <Text style={s.warningText}>You cannot vote until dues are cleared.</Text>
          </View>
        )}

        {election.rules && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Rules</Text>
            <Text style={s.rulesText} numberOfLines={4}>{election.rules}</Text>
            <Pressable onPress={() => router.push(`/estate/elections/${id}/rules` as never)}>
              <Text style={s.linkText}>Read full rules →</Text>
            </Pressable>
          </View>
        )}

        <Pressable style={s.outlineBtn} onPress={() => router.push(`/estate/elections/${id}/candidates` as never)}>
          <Ionicons name="people-outline" size={18} color={colors.primary.DEFAULT} />
          <Text style={s.outlineBtnText}>View Candidates</Text>
        </Pressable>

        {status === 'open' && !election.dues_owed && (
          <Pressable style={s.primaryBtn} onPress={() => router.push(`/estate/elections/${id}/vote` as never)}>
            <Text style={s.primaryBtnText}>Cast Your Vote</Text>
          </Pressable>
        )}

        {status === 'tallied' && (
          <Pressable style={s.purpleBtn} onPress={() => router.push(`/estate/elections/${id}/results` as never)}>
            <Ionicons name="podium-outline" size={18} color="#fff" />
            <Text style={s.primaryBtnText}>View Results</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutral.background, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff', flex: 1, textAlign: 'center' },
  body: { padding: 16, paddingBottom: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  electionTitle: { fontSize: 20, fontWeight: '700', color: colors.neutral.text, flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  description: { fontSize: 14, color: colors.neutral.textMuted, lineHeight: 22, marginBottom: 16 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.neutral.border },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateLabel: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600', width: 36 },
  dateValue: { fontSize: 13, color: colors.neutral.text },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.neutral.border },
  statNum: { fontSize: 22, fontWeight: '700', color: colors.primary.DEFAULT },
  statLabel: { fontSize: 11, color: colors.neutral.textMuted, marginTop: 2, textAlign: 'center' },
  warningCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fef2f2', borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#fecaca' },
  warningText: { fontSize: 13, color: colors.secondary.red, fontWeight: '600', flex: 1 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, marginBottom: 6 },
  rulesText: { fontSize: 13, color: colors.neutral.textMuted, lineHeight: 20 },
  linkText: { fontSize: 13, color: colors.secondary.DEFAULT, fontWeight: '600', marginTop: 4 },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 2, borderColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 14, marginBottom: 12 },
  outlineBtnText: { fontSize: 15, fontWeight: '700', color: colors.primary.DEFAULT },
  primaryBtn: { backgroundColor: colors.secondary.emerald, borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 12 },
  purpleBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 12 },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  errorText: { fontSize: 15, color: colors.neutral.text, marginTop: 12, marginBottom: 20, textAlign: 'center' },
  ghostBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, borderWidth: 1, borderColor: colors.neutral.border },
  ghostBtnText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
});
