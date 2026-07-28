// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const CATEGORIES = [
  { key: 'plumbing', label: 'Plumbing', icon: 'water-outline', color: '#0ea5e9' },
  { key: 'electrical', label: 'Electrical', icon: 'flash-outline', color: '#f59e0b' },
  { key: 'gate', label: 'Gate', icon: 'lock-closed-outline', color: '#dc2626' },
  { key: 'generator', label: 'Generator', icon: 'battery-charging-outline', color: '#f97316' },
  { key: 'elevator', label: 'Elevator', icon: 'arrow-up-outline', color: '#6b7280' },
  { key: 'water', label: 'Water', icon: 'water', color: '#0d9488' },
  { key: 'drainage', label: 'Drainage', icon: 'trail-sign-outline', color: '#92400e' },
  { key: 'pest', label: 'Pest', icon: 'bug-outline', color: '#16a34a' },
];

const URGENCIES = [
  { key: 'low', label: 'Low', color: '#16a34a' },
  { key: 'medium', label: 'Medium', color: '#92400e' },
  { key: 'urgent', label: 'Urgent', color: '#991b1b' },
];

export default function CreateRepairScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [urgency, setUrgency] = useState('low');

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/repairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, title, description, location, urgency }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      return res.json();
    },
    onSuccess: () => {
      Alert.alert('Success', 'Repair request submitted!', [{ text: 'OK', onPress: () => router.replace('/repairs' as never) }]);
    },
    onError: () => Alert.alert('Error', 'Failed to submit. Please try again.'),
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => (step === 2 ? setStep(1) : router.back())}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>{step === 1 ? 'Select Category' : 'Repair Details'}</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Step indicator */}
      <View style={s.stepRow}>
        <View style={[s.stepDot, step >= 1 && s.stepDotActive]} />
        <View style={[s.stepLine, step >= 2 && s.stepLineActive]} />
        <View style={[s.stepDot, step >= 2 && s.stepDotActive]} />
      </View>

      {step === 1 ? (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.sectionLabel}>What needs fixing?</Text>
          <View style={s.grid}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.key}
                style={[s.catTile, category === cat.key && { borderColor: cat.color, borderWidth: 2 }]}
                onPress={() => { setCategory(cat.key); setStep(2); }}
              >
                <View style={[s.catIcon, { backgroundColor: cat.color + '22' }]}>
                  <Ionicons name={cat.icon} size={28} color={cat.color} />
                </View>
                <Text style={s.catLabel}>{cat.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.label}>Title</Text>
          <TextInput style={s.input} placeholder="Brief description of the issue" placeholderTextColor={colors.neutral.placeholder} value={title} onChangeText={setTitle} />

          <Text style={s.label}>Description</Text>
          <TextInput
            style={[s.input, { height: 100, textAlignVertical: 'top' }]}
            placeholder="Provide details about the problem..."
            placeholderTextColor={colors.neutral.placeholder}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
          />

          <Text style={s.label}>Location</Text>
          <TextInput style={s.input} placeholder="e.g. Block A, Unit 4, Kitchen" placeholderTextColor={colors.neutral.placeholder} value={location} onChangeText={setLocation} />

          <Text style={s.label}>Urgency</Text>
          <View style={s.chipRow}>
            {URGENCIES.map((u) => (
              <Pressable
                key={u.key}
                style={[s.chip, urgency === u.key && { backgroundColor: u.color, borderColor: u.color }]}
                onPress={() => setUrgency(u.key)}
              >
                <Text style={[s.chipTxt, urgency === u.key && { color: '#fff' }]}>{u.label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[s.primaryBtn, mutation.isPending && { opacity: 0.6 }]}
            onPress={() => mutation.mutate()}
            disabled={mutation.isPending || !title.trim()}
          >
            <Text style={s.primaryBtnTxt}>{mutation.isPending ? 'Submitting…' : 'Submit Request'}</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 0 },
  stepDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.neutral.border },
  stepDotActive: { backgroundColor: colors.primary.DEFAULT },
  stepLine: { width: 60, height: 2, backgroundColor: colors.neutral.border },
  stepLineActive: { backgroundColor: colors.primary.DEFAULT },
  content: { padding: 20, gap: 16 },
  sectionLabel: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  catTile: { width: '47%', backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.neutral.border, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  catIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  chipRow: { flexDirection: 'row', gap: 10 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.neutral.border, alignItems: 'center' },
  chipTxt: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
