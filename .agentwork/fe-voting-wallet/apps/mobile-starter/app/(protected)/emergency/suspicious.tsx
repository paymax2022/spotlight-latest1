// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function SuspiciousActivityScreen() {
  const router = useRouter();
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [timeObserved, setTimeObserved] = useState('');
  const [anonymous, setAnonymous] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/emergency/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'suspicious', description, location, time_observed: timeObserved, anonymous }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => Alert.alert('Reported', 'Suspicious activity reported to security.', [{ text: 'OK', onPress: () => router.back() }]),
    onError: () => Alert.alert('Error', 'Report failed.'),
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Suspicious Activity</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.label}>Description</Text>
        <TextInput style={[s.input, { height: 100, textAlignVertical: 'top' }]} placeholder="Describe what you observed..." placeholderTextColor={colors.neutral.placeholder} value={description} onChangeText={setDescription} multiline numberOfLines={4} />

        <Text style={s.label}>Location</Text>
        <TextInput style={s.input} placeholder="Where did you observe this?" placeholderTextColor={colors.neutral.placeholder} value={location} onChangeText={setLocation} />

        <Text style={s.label}>Time Observed</Text>
        <TextInput style={s.input} placeholder="e.g. 10:30 PM" placeholderTextColor={colors.neutral.placeholder} value={timeObserved} onChangeText={setTimeObserved} />

        <View style={s.photoBox}>
          <Ionicons name="camera-outline" size={32} color={colors.neutral.placeholder} />
          <Text style={s.photoTxt}>Tap to upload evidence photo</Text>
        </View>

        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Report Anonymously</Text>
          <Switch value={anonymous} onValueChange={setAnonymous} trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }} thumbColor="#fff" />
        </View>

        <Pressable style={[s.submitBtn, (!description || mutation.isPending) && { opacity: 0.5 }]} onPress={() => mutation.mutate()} disabled={!description || mutation.isPending}>
          <Text style={s.submitBtnTxt}>{mutation.isPending ? 'Reporting…' : 'Report'}</Text>
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
  photoBox: { height: 100, borderRadius: 12, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoTxt: { fontSize: 13, color: colors.neutral.placeholder },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14 },
  switchLabel: { fontSize: 15, color: colors.neutral.text, fontWeight: '500' },
  submitBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  submitBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
