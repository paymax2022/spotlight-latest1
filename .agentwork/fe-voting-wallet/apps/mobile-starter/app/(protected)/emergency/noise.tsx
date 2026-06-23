// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const URGENCIES = ['Low', 'Medium', 'High'];

export default function NoiseComplaintScreen() {
  const router = useRouter();
  const [unit, setUnit] = useState('');
  const [time, setTime] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState('Medium');

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/emergency/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'noise', unit_number: unit, time, description, urgency }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => Alert.alert('Submitted', 'Noise complaint submitted.', [{ text: 'OK', onPress: () => router.back() }]),
    onError: () => Alert.alert('Error', 'Submission failed.'),
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Noise Complaint</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.label}>Unit Number</Text>
        <TextInput style={s.input} placeholder="e.g. Block A, Unit 12" placeholderTextColor={colors.neutral.placeholder} value={unit} onChangeText={setUnit} />

        <Text style={s.label}>Time of Occurrence</Text>
        <TextInput style={s.input} placeholder="e.g. 11:45 PM" placeholderTextColor={colors.neutral.placeholder} value={time} onChangeText={setTime} />

        <Text style={s.label}>Description</Text>
        <TextInput style={[s.input, { height: 100, textAlignVertical: 'top' }]} placeholder="Describe the noise disturbance..." placeholderTextColor={colors.neutral.placeholder} value={description} onChangeText={setDescription} multiline numberOfLines={4} />

        <Text style={s.label}>Urgency</Text>
        <View style={s.chipRow}>
          {URGENCIES.map((u) => (
            <Pressable key={u} style={[s.chip, urgency === u && s.chipActive]} onPress={() => setUrgency(u)}>
              <Text style={[s.chipTxt, urgency === u && s.chipTxtActive]}>{u}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={[s.submitBtn, (!unit || mutation.isPending) && { opacity: 0.5 }]} onPress={() => mutation.mutate()} disabled={!unit || mutation.isPending}>
          <Text style={s.submitBtnTxt}>{mutation.isPending ? 'Submitting…' : 'Submit Complaint'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#dc2626' },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  chipRow: { flexDirection: 'row', gap: 10 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.neutral.border, alignItems: 'center' },
  chipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  chipTxt: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  chipTxtActive: { color: '#fff' },
  submitBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  submitBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
