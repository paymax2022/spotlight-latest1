// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function CastVote() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [positions, setPositions] = useState([]);
  const [selections, setSelections] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => {
    fetch(`/api/estate/elections/${id}/candidates`)
      .then(r => r.json())
      .then(d => {
        const list = d.data ?? d ?? [];
        const grouped = list.reduce((acc, c) => {
          const pos = c.position ?? 'General';
          if (!acc[pos]) acc[pos] = [];
          acc[pos].push(c);
          return acc;
        }, {});
        setPositions(Object.entries(grouped).map(([name, candidates]) => ({ name, candidates })));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const allSelected = positions.length > 0 && positions.every(p => selections[p.name]);

  async function submitVote() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/estate/elections/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ votes: selections }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Vote failed');
      setShowReview(false);
      router.replace(`/estate/elections/${id}/vote-receipt` as never);
    } catch (e) {
      setError(e.message);
      setShowReview(false);
    } finally {
      setSubmitting(false);
    }
  }

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
        <Text style={s.hTitle}>Cast Your Vote</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {error && (
          <View style={s.errorCard}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.secondary.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {positions.map(pos => (
          <View key={pos.name} style={s.posSection}>
            <Text style={s.posTitle}>{pos.name}</Text>
            <Text style={s.posSubtitle}>Select one candidate</Text>
            {pos.candidates.map(c => {
              const selected = selections[pos.name] === c.id;
              return (
                <Pressable
                  key={c.id}
                  style={[s.candidateCard, selected && s.candidateCardSelected]}
                  onPress={() => setSelections(prev => ({ ...prev, [pos.name]: c.id }))}
                >
                  <View style={[s.avatar, { backgroundColor: getAvatarColor(c.name) }]}>
                    <Text style={s.avatarText}>{initials(c.name)}</Text>
                  </View>
                  <View style={s.cardContent}>
                    <Text style={[s.candidateName, selected && s.candidateNameSelected]}>{c.name}</Text>
                    <Text style={s.manifesto} numberOfLines={2}>{c.manifesto ?? 'No manifesto.'}</Text>
                  </View>
                  <View style={[s.radio, selected && s.radioSelected]}>
                    {selected && <View style={s.radioDot} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}

        <Pressable
          style={[s.submitBtn, !allSelected && s.submitBtnDisabled]}
          onPress={() => allSelected && setShowReview(true)}
          disabled={!allSelected}
        >
          <Text style={s.submitBtnText}>Review & Submit</Text>
        </Pressable>
        {!allSelected && (
          <Text style={s.hint}>Please select a candidate for each position to continue.</Text>
        )}
      </ScrollView>

      <Modal visible={showReview} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Review Your Vote</Text>
            {positions.map(pos => {
              const candidate = pos.candidates.find(c => c.id === selections[pos.name]);
              return (
                <View key={pos.name} style={s.reviewRow}>
                  <Text style={s.reviewPos}>{pos.name}</Text>
                  <Text style={s.reviewCandidate}>{candidate?.name ?? '—'}</Text>
                </View>
              );
            })}
            <View style={s.warningCard}>
              <Ionicons name="warning-outline" size={16} color={colors.secondary.amber} />
              <Text style={s.warningText}>This vote is final and cannot be changed.</Text>
            </View>
            <View style={s.modalActions}>
              <Pressable style={s.ghostBtn} onPress={() => setShowReview(false)}>
                <Text style={s.ghostBtnText}>Go Back</Text>
              </Pressable>
              <Pressable style={s.confirmBtn} onPress={submitVote} disabled={submitting}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.confirmBtnText}>Submit Vote</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  body: { padding: 16, paddingBottom: 40 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { fontSize: 13, color: colors.secondary.red, flex: 1 },
  posSection: { marginBottom: 24 },
  posTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 2 },
  posSubtitle: { fontSize: 13, color: colors.neutral.textMuted, marginBottom: 12 },
  candidateCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 2, borderColor: colors.neutral.border },
  candidateCardSelected: { borderColor: colors.primary.DEFAULT, backgroundColor: '#f5f0ff' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  cardContent: { flex: 1 },
  candidateName: { fontSize: 14, fontWeight: '700', color: colors.neutral.text, marginBottom: 2 },
  candidateNameSelected: { color: colors.primary.DEFAULT },
  manifesto: { fontSize: 12, color: colors.neutral.textMuted, lineHeight: 17 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary.DEFAULT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary.DEFAULT },
  submitBtn: { backgroundColor: colors.secondary.emerald, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  hint: { fontSize: 12, color: colors.neutral.textMuted, textAlign: 'center', marginTop: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.neutral.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.neutral.text, marginBottom: 20, textAlign: 'center' },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  reviewPos: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  reviewCandidate: { fontSize: 14, color: colors.neutral.text, fontWeight: '700' },
  warningCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fffbeb', borderRadius: 10, padding: 12, marginTop: 16, borderWidth: 1, borderColor: '#fde68a' },
  warningText: { fontSize: 13, color: '#92400e', flex: 1 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  ghostBtn: { flex: 1, borderWidth: 1, borderColor: colors.neutral.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ghostBtnText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
  confirmBtn: { flex: 1, backgroundColor: colors.secondary.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },
});
