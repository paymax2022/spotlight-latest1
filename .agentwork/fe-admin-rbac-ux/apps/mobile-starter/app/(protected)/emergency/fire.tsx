// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const FIRE_STEPS = [
  { n: 1, text: 'Alert other residents immediately' },
  { n: 2, text: 'Call 112 for fire service' },
  { n: 3, text: 'Evacuate the building calmly' },
  { n: 4, text: 'Do NOT use lifts — use stairs only' },
];

export default function FireEmergencyScreen() {
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/emergency/fire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'fire' }) });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => Alert.alert('Alert Sent', 'Fire alert reported to estate management.', [{ text: 'OK', onPress: () => router.replace('/emergency' as never) }]),
    onError: () => Alert.alert('Error', 'Failed to report fire.'),
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Fire Emergency</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.assemblyCard}>
          <Ionicons name="location-outline" size={24} color="#f97316" />
          <View style={{ flex: 1 }}>
            <Text style={s.assemblyTitle}>Assembly Point</Text>
            <Text style={s.assemblyTxt}>Main Gate Car Park — Gate A (North End)</Text>
          </View>
        </View>

        <Text style={s.sectionLabel}>Emergency Steps</Text>
        {FIRE_STEPS.map((step) => (
          <View key={step.n} style={s.stepRow}>
            <View style={s.stepNum}><Text style={s.stepNumTxt}>{step.n}</Text></View>
            <Text style={s.stepTxt}>{step.text}</Text>
          </View>
        ))}

        <Pressable style={[s.reportBtn, mutation.isPending && { opacity: 0.6 }]} onPress={() => mutation.mutate()} disabled={mutation.isPending}>
          <Ionicons name="flame" size={20} color="#fff" />
          <Text style={s.reportBtnTxt}>{mutation.isPending ? 'Reporting…' : 'Report Active Fire'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#f97316' },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  assemblyCard: { flexDirection: 'row', gap: 12, backgroundColor: '#fff7ed', borderRadius: 14, padding: 16, alignItems: 'center' },
  assemblyTitle: { fontSize: 13, fontWeight: '700', color: '#9a3412' },
  assemblyTxt: { fontSize: 14, color: '#c2410c', marginTop: 2 },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  stepRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#f97316', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  stepTxt: { flex: 1, fontSize: 14, color: colors.neutral.text, lineHeight: 20 },
  reportBtn: { backgroundColor: '#f97316', borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  reportBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
