// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function NominationForm() {
  const router = useRouter();
  const [elections, setElections] = useState([]);
  const [positions, setPositions] = useState([]);
  const [selectedElection, setSelectedElection] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('');
  const [fullName, setFullName] = useState('');
  const [manifesto, setManifesto] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/estate/elections?status=open')
      .then(r => r.json())
      .then(d => setElections(d.data ?? d ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedElection) { setPositions([]); return; }
    fetch(`/api/estate/elections/${selectedElection}/positions`)
      .then(r => r.json())
      .then(d => setPositions(d.data ?? d ?? []))
      .catch(() => {});
  }, [selectedElection]);

  async function handleSubmit() {
    if (!selectedElection) { setError('Please select an election.'); return; }
    if (!selectedPosition) { setError('Please select a position.'); return; }
    if (!fullName.trim()) { setError('Full name is required.'); return; }
    if (!manifesto.trim()) { setError('Manifesto is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/estate/elections/${selectedElection}/nominations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: selectedPosition, name: fullName, manifesto, campaign_message: campaignMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Submission failed');
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
          <Text style={s.hTitle}>Nomination</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={s.successBody}>
          <View style={s.successCircle}>
            <Ionicons name="checkmark" size={36} color="#fff" />
          </View>
          <Text style={s.successTitle}>Nomination Submitted!</Text>
          <Text style={s.successSubtitle}>Your nomination is pending review by the Electoral Committee. You will be notified once it is approved.</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.replace('/estate/elections' as never)}>
            <Text style={s.primaryBtnText}>Back to Elections</Text>
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
        <Text style={s.hTitle}>Submit Nomination</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Election</Text>
        {elections.length === 0 ? (
          <View style={s.infoCard}>
            <Text style={s.infoText}>No open elections available for nomination at this time.</Text>
          </View>
        ) : (
          elections.map(e => (
            <Pressable
              key={e.id}
              style={[s.optionCard, selectedElection === e.id && s.optionCardActive]}
              onPress={() => { setSelectedElection(e.id); setSelectedPosition(''); }}
            >
              <Text style={[s.optionText, selectedElection === e.id && s.optionTextActive]}>{e.title}</Text>
              {selectedElection === e.id && <Ionicons name="checkmark-circle" size={20} color={colors.primary.DEFAULT} />}
            </Pressable>
          ))
        )}

        {selectedElection && (
          <>
            <Text style={s.label}>Position</Text>
            {positions.map(pos => (
              <Pressable
                key={pos.id ?? pos.name}
                style={[s.optionCard, selectedPosition === (pos.id ?? pos.name) && s.optionCardActive]}
                onPress={() => setSelectedPosition(pos.id ?? pos.name)}
              >
                <Text style={[s.optionText, selectedPosition === (pos.id ?? pos.name) && s.optionTextActive]}>{pos.name}</Text>
                {selectedPosition === (pos.id ?? pos.name) && <Ionicons name="checkmark-circle" size={20} color={colors.primary.DEFAULT} />}
              </Pressable>
            ))}
          </>
        )}

        <Text style={s.label}>Full Name</Text>
        <TextInput style={s.input} placeholder="Your legal full name" placeholderTextColor={colors.neutral.placeholder} value={fullName} onChangeText={setFullName} />

        <Text style={s.label}>Manifesto</Text>
        <TextInput style={[s.input, s.textArea]} placeholder="Describe your plans and vision for this position..." placeholderTextColor={colors.neutral.placeholder} multiline numberOfLines={6} textAlignVertical="top" value={manifesto} onChangeText={setManifesto} />

        <Text style={s.label}>Campaign Message (Optional)</Text>
        <TextInput style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} placeholder="A short message to voters..." placeholderTextColor={colors.neutral.placeholder} multiline value={campaignMessage} onChangeText={setCampaignMessage} />

        <View style={s.pendingNote}>
          <Ionicons name="time-outline" size={16} color={colors.secondary.amber} />
          <Text style={s.pendingNoteText}>Nominations are subject to admin approval before appearing on the candidate list.</Text>
        </View>

        {error ? (
          <View style={s.errorCard}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.secondary.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable style={s.submitBtn} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.submitBtnText}>Submit Nomination</Text>}
        </Pressable>
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
  label: { fontSize: 13, fontWeight: '700', color: colors.neutral.text, marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.neutral.border, padding: 12, fontSize: 14, color: colors.neutral.text },
  textArea: { minHeight: 130, textAlignVertical: 'top' },
  optionCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.neutral.surface, borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.neutral.border },
  optionCardActive: { borderColor: colors.primary.DEFAULT, backgroundColor: '#f5f0ff' },
  optionText: { fontSize: 14, color: colors.neutral.text, flex: 1 },
  optionTextActive: { color: colors.primary.DEFAULT, fontWeight: '700' },
  infoCard: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 14 },
  infoText: { fontSize: 13, color: colors.neutral.textMuted },
  pendingNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fffbeb', borderRadius: 10, padding: 12, marginTop: 16, marginBottom: 8, borderWidth: 1, borderColor: '#fde68a' },
  pendingNoteText: { fontSize: 13, color: '#92400e', flex: 1, lineHeight: 19 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { fontSize: 13, color: colors.secondary.red, flex: 1 },
  submitBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  successCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.secondary.emerald, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { fontSize: 22, fontWeight: '700', color: colors.neutral.text, marginBottom: 8 },
  successSubtitle: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center' },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
