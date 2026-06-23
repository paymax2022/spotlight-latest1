// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listGates, submitIncident } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const INCIDENT_TYPES = [
  { type: 'trespassing', label: 'Trespassing', icon: 'person-remove-outline', color: '#EF4444' },
  { type: 'altercation', label: 'Altercation', icon: 'hand-left-outline', color: '#F59E0B' },
  { type: 'theft', label: 'Theft', icon: 'bag-remove-outline', color: '#DC2626' },
  { type: 'suspicious', label: 'Suspicious', icon: 'eye-outline', color: '#8B5CF6' },
  { type: 'vehicle', label: 'Vehicle', icon: 'car-outline', color: '#3B82F6' },
  { type: 'medical', label: 'Medical', icon: 'medkit-outline', color: '#10B981' },
  { type: 'fire', label: 'Fire', icon: 'flame-outline', color: '#DC2626' },
  { type: 'other', label: 'Other', icon: 'alert-circle-outline', color: '#94A3B8' },
];

export default function IncidentScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [incidentType, setIncidentType] = useState('');
  const [description, setDescription] = useState('');
  const [gateId, setGateId] = useState('');
  const [escalated, setEscalated] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState('');

  const { data: gates = [] } = useQuery({
    queryKey: ['estate-gates'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return listGates(ctx.estateId);
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return submitIncident(ctx.estateId, {
        gate_id: gateId || undefined,
        incident_type: incidentType,
        description,
        evidence_url: evidenceUrl || undefined,
        escalated,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      Alert.alert('Reported', escalated ? 'Incident reported and escalated to estate admin.' : 'Incident report submitted.');
      router.back();
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Failed to submit report'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Incident Report</Text>

        <Text style={styles.label}>Incident Type *</Text>
        <View style={styles.typeGrid}>
          {INCIDENT_TYPES.map((it) => (
            <Pressable
              key={it.type}
              style={[styles.typeTile, incidentType === it.type && { borderColor: it.color, backgroundColor: it.color + '10' }]}
              onPress={() => setIncidentType(it.type)}
            >
              <Ionicons name={it.icon as any} size={20} color={it.color} />
              <Text style={[styles.typeTileText, { color: incidentType === it.type ? it.color : colors.neutral.text }]}>{it.label}</Text>
            </Pressable>
          ))}
        </View>

        {gates.length > 0 && (
          <>
            <Text style={styles.label}>Gate (optional)</Text>
            <View style={styles.gateChips}>
              {gates.map((g) => (
                <Pressable key={g.id} style={[styles.gateChip, gateId === g.id && styles.gateChipActive]} onPress={() => setGateId(g.id === gateId ? '' : g.id)}>
                  <Text style={[styles.gateChipText, gateId === g.id && styles.gateChipTextActive]}>{g.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>Description *</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={description}
          onChangeText={setDescription}
          placeholder="Describe what happened in detail…"
          placeholderTextColor={colors.neutral.placeholder}
          multiline
          maxLength={1000}
        />

        <Text style={styles.label}>Evidence URL (optional)</Text>
        <TextInput style={styles.input} value={evidenceUrl} onChangeText={setEvidenceUrl} placeholder="https://r2.paymax.app/…" placeholderTextColor={colors.neutral.placeholder} autoCapitalize="none" keyboardType="url" />

        <View style={styles.escalateRow}>
          <View>
            <Text style={styles.escalateLabel}>Escalate to Admin</Text>
            <Text style={styles.escalateSub}>Admin will be notified immediately</Text>
          </View>
          <Switch value={escalated} onValueChange={setEscalated} trackColor={{ true: '#EF4444' }} />
        </View>

        <Pressable
          style={[styles.submitBtn, { backgroundColor: escalated ? '#EF4444' : colors.primary.DEFAULT }, (!incidentType || !description || mutation.isPending) && styles.disabled]}
          onPress={() => mutation.mutate()}
          disabled={!incidentType || !description || mutation.isPending}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="warning-outline" size={18} color="#fff" />
              <Text style={styles.submitBtnText}>{escalated ? 'Report & Escalate' : 'Submit Report'}</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 12 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, marginTop: 4 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeTile: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: '#E2E8F0' },
  typeTileText: { fontSize: 13, fontWeight: '600' },
  gateChips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  gateChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  gateChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  gateChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  gateChipTextActive: { color: '#fff' },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  textarea: { height: 120, textAlignVertical: 'top' },
  escalateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14 },
  escalateLabel: { fontSize: 14, fontWeight: '700', color: '#991B1B' },
  escalateSub: { fontSize: 12, color: '#EF4444', marginTop: 2 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 16, marginTop: 4 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
