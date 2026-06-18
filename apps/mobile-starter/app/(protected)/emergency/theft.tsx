// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function TheftReportScreen() {
  const router = useRouter();
  const [location, setLocation] = useState('');
  const [item, setItem] = useState('');
  const [value, setValue] = useState('');
  const [suspects, setSuspects] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/emergency/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'theft', location, item_stolen: item, estimated_value: value, suspects_description: suspects }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => Alert.alert('Reported', 'Theft report submitted to security.', [{ text: 'OK', onPress: () => router.back() }]),
    onError: () => Alert.alert('Error', 'Report failed.'),
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Theft Report</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.label}>Location of Theft</Text>
        <TextInput style={s.input} placeholder="Where did it occur?" placeholderTextColor={colors.neutral.placeholder} value={location} onChangeText={setLocation} />

        <Text style={s.label}>Item Stolen</Text>
        <TextInput style={s.input} placeholder="What was taken?" placeholderTextColor={colors.neutral.placeholder} value={item} onChangeText={setItem} />

        <Text style={s.label}>Estimated Value (₦)</Text>
        <TextInput style={s.input} placeholder="Approximate value" placeholderTextColor={colors.neutral.placeholder} value={value} onChangeText={setValue} keyboardType="numeric" />

        <Text style={s.label}>Suspects Description (optional)</Text>
        <TextInput style={[s.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Describe the suspect(s)..." placeholderTextColor={colors.neutral.placeholder} value={suspects} onChangeText={setSuspects} multiline />

        <View style={s.photoBox}>
          <Ionicons name="camera-outline" size={32} color={colors.neutral.placeholder} />
          <Text style={s.photoTxt}>Upload evidence photos</Text>
        </View>

        <Pressable style={[s.submitBtn, (!location || !item || mutation.isPending) && { opacity: 0.5 }]} onPress={() => mutation.mutate()} disabled={!location || !item || mutation.isPending}>
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
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  photoBox: { height: 100, borderRadius: 12, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoTxt: { fontSize: 13, color: colors.neutral.placeholder },
  submitBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  submitBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
