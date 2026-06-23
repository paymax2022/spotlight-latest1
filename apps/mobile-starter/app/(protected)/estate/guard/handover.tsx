// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { handoverShift, listGates } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function HandoverScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [gateId, setGateId] = useState('');
  const [notes, setNotes] = useState('');
  const [relievedBy, setRelievedBy] = useState('');

  const { data: gates = [] } = useQuery({
    queryKey: ['estate-gates'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return listGates(ctx.estateId);
    },
    onSuccess: (g) => { if (g.length > 0 && !gateId) setGateId(g[0].id); },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return handoverShift(ctx.estateId, {
        gate_id: gateId,
        handover_notes: notes || undefined,
        relieved_by: relievedBy || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guard-shift'] });
      Alert.alert('Shift Handed Over', 'A new shift has been opened. Stay safe!');
      router.back();
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Handover failed'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Shift Handover</Text>
        <Text style={styles.sub}>Closing your current shift and starting the next one at the selected gate.</Text>

        <Text style={styles.label}>Gate *</Text>
        <View style={styles.gateRow}>
          {gates.map((g) => (
            <Pressable key={g.id} style={[styles.gateChip, gateId === g.id && styles.gateChipActive]} onPress={() => setGateId(g.id)}>
              <Text style={[styles.gateChipText, gateId === g.id && styles.gateChipTextActive]}>{g.name}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Incoming Guard (optional)</Text>
        <TextInput style={styles.input} value={relievedBy} onChangeText={setRelievedBy} placeholder="Name or ID of relieving guard" placeholderTextColor={colors.neutral.placeholder} />

        <Text style={styles.label}>Handover Notes</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything the next guard should know…"
          placeholderTextColor={colors.neutral.placeholder}
          multiline
          maxLength={500}
        />

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color="#6C63FF" />
          <Text style={styles.infoText}>This will close your current active shift and open a new one immediately.</Text>
        </View>

        <Pressable
          style={[styles.submitBtn, (!gateId || mutation.isPending) && styles.disabled]}
          onPress={() => mutation.mutate()}
          disabled={!gateId || mutation.isPending}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="swap-horizontal-outline" size={20} color="#fff" />
              <Text style={styles.submitBtnText}>Complete Handover</Text>
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
  sub: { fontSize: 14, color: colors.neutral.textMuted, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, marginTop: 4 },
  gateRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  gateChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  gateChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  gateChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  gateChipTextActive: { color: '#fff' },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  textarea: { height: 120, textAlignVertical: 'top' },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#EEF2FF', borderRadius: 10, padding: 12 },
  infoText: { flex: 1, fontSize: 12, color: '#6C63FF', lineHeight: 18 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#8B5CF6', borderRadius: 14, paddingVertical: 16, marginTop: 4 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
