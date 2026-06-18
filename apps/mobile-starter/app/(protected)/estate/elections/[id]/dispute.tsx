// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const NATURES = ['Irregularity', 'Candidate Ineligibility', 'Process Violation', 'Other'];

export default function ElectionDispute() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [election, setElection] = useState(null);
  const [nature, setNature] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/estate/elections/${id}`)
      .then(r => r.json())
      .then(d => setElection(d.data ?? d))
      .catch(() => {});
  }, [id]);

  async function handleSubmit() {
    if (!nature) { setError('Please select a dispute type.'); return; }
    if (!description.trim()) { setError('Please describe the dispute.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/estate/elections/${id}/disputes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nature, description }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? 'Submission failed');
      }
      setSuccess(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <View style={s.header}>
          <View style={{ width: 38 }} />
          <Text style={s.hTitle}>Dispute Submitted</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={s.successBody}>
          <View style={s.successCircle}>
            <Ionicons name="checkmark" size={36} color="#fff" />
          </View>
          <Text style={s.successTitle}>Dispute Filed</Text>
          <Text style={s.successSubtitle}>Your dispute has been submitted. The Electoral Committee will review it within 48 hours.</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.back()}>
            <Text style={s.primaryBtnText}>Back to Election</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>File a Dispute</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {election && (
          <View style={s.electionBanner}>
            <Ionicons name="podium-outline" size={16} color={colors.primary.DEFAULT} />
            <Text style={s.electionTitle} numberOfLines={1}>{election.title}</Text>
          </View>
        )}

        <Text style={s.label}>Nature of Dispute</Text>
        <View style={s.chipsRow}>
          {NATURES.map(n => (
            <Pressable
              key={n}
              style={[s.chip, nature === n && s.chipActive]}
              onPress={() => setNature(n)}
            >
              <Text style={[s.chipText, nature === n && s.chipTextActive]}>{n}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Description</Text>
        <TextInput
          style={s.textArea}
          placeholder="Describe the nature of the dispute in detail..."
          placeholderTextColor={colors.neutral.placeholder}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          value={description}
          onChangeText={setDescription}
        />

        <View style={s.evidencePlaceholder}>
          <Ionicons name="attach-outline" size={20} color={colors.neutral.placeholder} />
          <Text style={s.evidenceText}>Evidence upload (coming soon)</Text>
        </View>

        {error ? (
          <View style={s.errorCard}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.secondary.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable style={s.submitBtn} onPress={handleSubmit} disabled={submitting}>
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={s.submitBtnText}>Submit Dispute</Text>
          )}
        </Pressable>

        <View style={s.noteCard}>
          <Ionicons name="information-circle-outline" size={16} color={colors.neutral.textMuted} />
          <Text style={s.noteText}>Disputes are reviewed within 48 hours by the Electoral Committee.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  body: { padding: 16, paddingBottom: 40 },
  electionBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 20 },
  electionTitle: { fontSize: 14, color: colors.neutral.text, fontWeight: '600', flex: 1 },
  label: { fontSize: 13, fontWeight: '700', color: colors.neutral.text, marginBottom: 8 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1, borderColor: colors.neutral.border },
  chipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  chipText: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  textArea: { backgroundColor: colors.neutral.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, padding: 14, fontSize: 14, color: colors.neutral.text, minHeight: 140, marginBottom: 16 },
  evidencePlaceholder: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.neutral.border, borderStyle: 'dashed', borderRadius: 10, padding: 14, marginBottom: 20 },
  evidenceText: { fontSize: 13, color: colors.neutral.placeholder },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { fontSize: 13, color: colors.secondary.red, flex: 1 },
  submitBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 16 },
  submitBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12 },
  noteText: { fontSize: 13, color: colors.neutral.textMuted, flex: 1, lineHeight: 19 },
  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  successCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.secondary.emerald, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '700', color: colors.neutral.text, marginBottom: 8 },
  successSubtitle: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center' },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
