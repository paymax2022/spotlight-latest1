// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const RESPONSE_STEPS = [
  { key: 'received', label: 'Alert Received', icon: 'checkmark-circle' },
  { key: 'dispatched', label: 'Guard Dispatched', icon: 'walk-outline' },
  { key: 'arriving', label: 'Guard Arriving', icon: 'navigate-outline' },
  { key: 'resolved', label: 'Resolved', icon: 'shield-checkmark' },
];

export default function ResponseTrackingScreen() {
  const router = useRouter();
  const { alertId } = useLocalSearchParams();
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimer = useRef(null);

  const { data: status, refetch } = useQuery({
    queryKey: ['alert-status', alertId],
    queryFn: async () => {
      const res = await fetch(`/api/emergency/alerts/${alertId ?? 'latest'}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    refetchInterval: 10000,
  });

  const currentStep = RESPONSE_STEPS.findIndex((s) => s.key === status?.stage) ?? 0;

  const handleCancelHoldStart = () => {
    setHoldProgress(1);
    let progress = 0;
    holdTimer.current = setInterval(() => {
      progress += 10;
      setHoldProgress(progress);
      if (progress >= 100) {
        clearInterval(holdTimer.current);
        Alert.alert('Alert Cancelled', 'Your emergency alert has been cancelled.', [{ text: 'OK', onPress: () => router.replace('/emergency' as never) }]);
      }
    }, 200);
  };
  const handleCancelHoldEnd = () => { clearInterval(holdTimer.current); setHoldProgress(0); };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Response Tracking</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {RESPONSE_STEPS.map((step, i) => {
          const done = i <= currentStep;
          return (
            <View key={step.key} style={[s.stepCard, done && s.stepCardDone]}>
              <View style={[s.stepIcon, done && s.stepIconDone]}>
                <Ionicons name={step.icon} size={22} color={done ? '#fff' : colors.neutral.placeholder} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.stepLabel, done && s.stepLabelDone]}>{step.label}</Text>
                {step.key === 'arriving' && status?.eta && <Text style={s.etaTxt}>ETA: {status.eta} mins</Text>}
              </View>
              {done && <Ionicons name="checkmark-circle" size={20} color="#16a34a" />}
            </View>
          );
        })}

        {status?.responder_phone && (
          <Pressable style={s.contactBtn} onPress={() => Linking.openURL(`tel:${status.responder_phone}`)}>
            <Ionicons name="call" size={20} color="#fff" />
            <Text style={s.contactBtnTxt}>Contact Responder</Text>
          </Pressable>
        )}

        <Pressable
          style={[s.cancelBtn, { borderWidth: 2, borderColor: `rgba(220,38,38,${holdProgress / 100})` }]}
          onPressIn={handleCancelHoldStart}
          onPressOut={handleCancelHoldEnd}
        >
          <Text style={s.cancelBtnTxt}>Hold 2s to Cancel Alert ({Math.round(holdProgress)}%)</Text>
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
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  stepCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: colors.neutral.border },
  stepCardDone: { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
  stepIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  stepIconDone: { backgroundColor: '#16a34a' },
  stepLabel: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
  stepLabelDone: { color: colors.neutral.text },
  etaTxt: { fontSize: 12, color: '#16a34a', fontWeight: '600', marginTop: 2 },
  contactBtn: { backgroundColor: '#2563eb', borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  contactBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  cancelBtnTxt: { color: '#dc2626', fontSize: 14, fontWeight: '600' },
});
