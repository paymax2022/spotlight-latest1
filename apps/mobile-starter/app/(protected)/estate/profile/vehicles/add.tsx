// @ts-nocheck
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addVehicle } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function AddVehicleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [docUrl, setDocUrl] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return addVehicle(ctx.estateId, {
        plate: plate.trim().toUpperCase(),
        make: make || undefined,
        model: model || undefined,
        color: color || undefined,
        doc_url: docUrl || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resident-vehicles'] });
      Alert.alert('Registered', 'Vehicle submitted for verification.');
      router.back();
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Registration failed'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Register Vehicle</Text>
        <Text style={styles.sub}>Your vehicle will be verified by the estate admin before gate access is granted.</Text>

        <Text style={styles.label}>Plate Number *</Text>
        <TextInput
          style={[styles.input, styles.plateInput]}
          value={plate}
          onChangeText={(v) => setPlate(v.toUpperCase())}
          placeholder="e.g. LAS-123-AA"
          placeholderTextColor={colors.neutral.placeholder}
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Make</Text>
        <TextInput style={styles.input} value={make} onChangeText={setMake} placeholder="Toyota, Honda…" placeholderTextColor={colors.neutral.placeholder} />

        <Text style={styles.label}>Model</Text>
        <TextInput style={styles.input} value={model} onChangeText={setModel} placeholder="Camry, Civic…" placeholderTextColor={colors.neutral.placeholder} />

        <Text style={styles.label}>Color</Text>
        <TextInput style={styles.input} value={color} onChangeText={setColor} placeholder="Silver, Black…" placeholderTextColor={colors.neutral.placeholder} />

        <Text style={styles.label}>Document URL (optional)</Text>
        <TextInput
          style={styles.input}
          value={docUrl}
          onChangeText={setDocUrl}
          placeholder="https://r2.paymax.app/…"
          placeholderTextColor={colors.neutral.placeholder}
          autoCapitalize="none"
          keyboardType="url"
        />

        <Pressable
          style={[styles.submitBtn, (!plate || mutation.isPending) && styles.disabled]}
          onPress={() => mutation.mutate()}
          disabled={!plate || mutation.isPending}
        >
          {mutation.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitBtnText}>Submit for Verification</Text>
          }
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 10 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted, lineHeight: 20, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, marginTop: 6 },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  plateInput: { fontFamily: 'monospace', fontSize: 18, fontWeight: '800', letterSpacing: 2, textAlign: 'center' },
  submitBtn: { backgroundColor: '#10B981', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  disabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
