// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

type Candidate = { name: string; manifesto: string };
type Position = { name: string; candidates: Candidate[] };

export default function CreateElection() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [counting, setCounting] = useState<'manual' | 'automatic'>('automatic');
  const [paymentRequired, setPaymentRequired] = useState(true);
  const [positions, setPositions] = useState<Position[]>([]);
  const [newPos, setNewPos] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function addPosition() {
    if (!newPos.trim()) return;
    setPositions(p => [...p, { name: newPos.trim(), candidates: [] }]);
    setNewPos('');
  }

  function addCandidate(posIdx: number) {
    setPositions(p => p.map((pos, i) =>
      i === posIdx ? { ...pos, candidates: [...pos.candidates, { name: '', manifesto: '' }] } : pos
    ));
  }

  function updateCandidate(posIdx: number, cIdx: number, field: keyof Candidate, val: string) {
    setPositions(p => p.map((pos, i) =>
      i === posIdx ? {
        ...pos,
        candidates: pos.candidates.map((c, j) => j === cIdx ? { ...c, [field]: val } : c),
      } : pos
    ));
  }

  function removePosition(posIdx: number) {
    setPositions(p => p.filter((_, i) => i !== posIdx));
  }

  async function handlePublish() {
    if (!title.trim()) { setError('Title is required.'); return; }
    if (!startDate || !endDate) { setError('Start and end dates are required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/estate/elections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, start_date: startDate, end_date: endDate, counting_method: counting, payment_eligibility_required: paymentRequired, positions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Failed to create election');
      router.replace('/estate/elections' as never);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>Create Election</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Election Title *</Text>
        <TextInput style={s.input} placeholder="e.g. Annual Estate Executive Election 2025" placeholderTextColor={colors.neutral.placeholder} value={title} onChangeText={setTitle} />

        <Text style={s.label}>Description</Text>
        <TextInput style={[s.input, s.textArea]} placeholder="Describe the purpose and scope of this election..." placeholderTextColor={colors.neutral.placeholder} multiline numberOfLines={4} textAlignVertical="top" value={description} onChangeText={setDescription} />

        <Text style={s.label}>Start Date & Time *</Text>
        <TextInput style={s.input} placeholder="YYYY-MM-DD HH:MM" placeholderTextColor={colors.neutral.placeholder} value={startDate} onChangeText={setStartDate} />

        <Text style={s.label}>End Date & Time *</Text>
        <TextInput style={s.input} placeholder="YYYY-MM-DD HH:MM" placeholderTextColor={colors.neutral.placeholder} value={endDate} onChangeText={setEndDate} />

        <Text style={s.label}>Vote Counting</Text>
        <View style={s.countingRow}>
          {(['manual', 'automatic'] as const).map(method => (
            <Pressable key={method} style={[s.countingOption, counting === method && s.countingOptionActive]} onPress={() => setCounting(method)}>
              <Ionicons name={method === 'automatic' ? 'flash-outline' : 'hand-left-outline'} size={16} color={counting === method ? '#fff' : colors.neutral.textMuted} />
              <Text style={[s.countingText, counting === method && s.countingTextActive]}>{method.charAt(0).toUpperCase() + method.slice(1)}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.switchRow}>
          <View>
            <Text style={s.switchLabel}>Payment Eligibility Required</Text>
            <Text style={s.switchSub}>Residents with unpaid dues cannot vote</Text>
          </View>
          <Switch value={paymentRequired} onValueChange={setPaymentRequired} trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }} thumbColor="#fff" />
        </View>

        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Positions</Text>
        </View>

        {positions.map((pos, posIdx) => (
          <View key={posIdx} style={s.posCard}>
            <View style={s.posCardHeader}>
              <Text style={s.posCardTitle}>{pos.name}</Text>
              <Pressable onPress={() => removePosition(posIdx)}>
                <Ionicons name="trash-outline" size={18} color={colors.secondary.red} />
              </Pressable>
            </View>
            {pos.candidates.map((c, cIdx) => (
              <View key={cIdx} style={s.candidateForm}>
                <TextInput style={[s.input, { marginBottom: 6 }]} placeholder="Candidate name" placeholderTextColor={colors.neutral.placeholder} value={c.name} onChangeText={v => updateCandidate(posIdx, cIdx, 'name', v)} />
                <TextInput style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} placeholder="Candidate manifesto" placeholderTextColor={colors.neutral.placeholder} multiline value={c.manifesto} onChangeText={v => updateCandidate(posIdx, cIdx, 'manifesto', v)} />
              </View>
            ))}
            <Pressable style={s.addCandidateBtn} onPress={() => addCandidate(posIdx)}>
              <Ionicons name="person-add-outline" size={16} color={colors.secondary.DEFAULT} />
              <Text style={s.addCandidateBtnText}>+ Add Candidate</Text>
            </Pressable>
          </View>
        ))}

        <View style={s.addPositionRow}>
          <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} placeholder="Position name (e.g. President)" placeholderTextColor={colors.neutral.placeholder} value={newPos} onChangeText={setNewPos} />
          <Pressable style={s.addBtn} onPress={addPosition}>
            <Text style={s.addBtnText}>Add</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={s.errorCard}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.secondary.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable style={s.publishBtn} onPress={handlePublish} disabled={submitting}>
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.publishBtnText}>Publish Election</Text>}
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
  label: { fontSize: 13, fontWeight: '700', color: colors.neutral.text, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.neutral.border, padding: 12, fontSize: 14, color: colors.neutral.text, marginBottom: 0 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  countingRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  countingOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.neutral.border, borderRadius: 10, paddingVertical: 12, backgroundColor: colors.neutral.surface },
  countingOptionActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  countingText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
  countingTextActive: { color: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.neutral.surface, borderRadius: 10, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.neutral.border },
  switchLabel: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  switchSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  sectionHeader: { marginTop: 24, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.neutral.border, paddingBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  posCard: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.neutral.border },
  posCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  posCardTitle: { fontSize: 14, fontWeight: '700', color: colors.primary.DEFAULT },
  candidateForm: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 8, padding: 10, marginBottom: 8 },
  addCandidateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addCandidateBtnText: { fontSize: 13, color: colors.secondary.DEFAULT, fontWeight: '600' },
  addPositionRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4, marginBottom: 20 },
  addBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18 },
  addBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { fontSize: 13, color: colors.secondary.red, flex: 1 },
  publishBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  publishBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
