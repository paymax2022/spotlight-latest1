// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const CATEGORIES = ['Theft', 'Vandalism', 'Noise', 'Fire', 'Medical', 'Other'];

export default function CreateIncidentScreen() {
  const router = useRouter();
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [description, setDescription] = useState('');
  const [anonymous, setAnonymous] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/emergency/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: category.toLowerCase(), location, date, time, description, anonymous }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: (data) => {
      Alert.alert('Reported', 'Incident report submitted.', [{ text: 'OK', onPress: () => router.replace(`/emergency/incident/${data.id}` as never) }]);
    },
    onError: () => Alert.alert('Error', 'Failed to submit report.'),
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Report Incident</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.label}>Category</Text>
        <View style={s.categoryGrid}>
          {CATEGORIES.map((c) => (
            <Pressable key={c} style={[s.catChip, category === c && s.catChipActive]} onPress={() => setCategory(c)}>
              <Text style={[s.catChipTxt, category === c && s.catChipTxtActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Location</Text>
        <TextInput style={s.input} placeholder="Where did this happen?" placeholderTextColor={colors.neutral.placeholder} value={location} onChangeText={setLocation} />

        <View style={s.dateTimeRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Date</Text>
            <TextInput style={s.input} placeholder="DD/MM/YYYY" placeholderTextColor={colors.neutral.placeholder} value={date} onChangeText={setDate} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Time</Text>
            <TextInput style={s.input} placeholder="HH:MM" placeholderTextColor={colors.neutral.placeholder} value={time} onChangeText={setTime} />
          </View>
        </View>

        <Text style={s.label}>Description</Text>
        <TextInput style={[s.input, { height: 100, textAlignVertical: 'top' }]} placeholder="Describe what happened..." placeholderTextColor={colors.neutral.placeholder} value={description} onChangeText={setDescription} multiline numberOfLines={4} />

        <View style={s.photoBox}>
          <Ionicons name="camera-outline" size={32} color={colors.neutral.placeholder} />
          <Text style={s.photoTxt}>Upload evidence (optional)</Text>
        </View>

        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Report Anonymously</Text>
          <Switch value={anonymous} onValueChange={setAnonymous} trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }} thumbColor="#fff" />
        </View>

        <Pressable style={[s.submitBtn, (!category || !description || mutation.isPending) && { opacity: 0.5 }]} onPress={() => mutation.mutate()} disabled={!category || !description || mutation.isPending}>
          <Text style={s.submitBtnTxt}>{mutation.isPending ? 'Submitting…' : 'Submit Report'}</Text>
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
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface },
  catChipActive: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  catChipTxt: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '500' },
  catChipTxtActive: { color: '#fff', fontWeight: '700' },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  dateTimeRow: { flexDirection: 'row', gap: 12 },
  photoBox: { height: 100, borderRadius: 12, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoTxt: { fontSize: 13, color: colors.neutral.placeholder },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14 },
  switchLabel: { fontSize: 15, color: colors.neutral.text, fontWeight: '500' },
  submitBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  submitBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
