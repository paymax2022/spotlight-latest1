// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const PAY_METHODS = [
  { key: 'wallet', label: 'Wallet', icon: 'wallet-outline' },
  { key: 'card', label: 'Card', icon: 'card-outline' },
  { key: 'transfer', label: 'Transfer', icon: 'swap-horizontal-outline' },
  { key: 'ussd', label: 'USSD', icon: 'keypad-outline' },
];

export default function FacilityBookingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { facilityId, date, slot } = params;
  const [payMethod, setPayMethod] = useState('wallet');
  const [loading, setLoading] = useState(false);

  const { data: facility } = useQuery({
    queryKey: ['facility', facilityId],
    queryFn: async () => {
      const res = await fetch(`/api/facilities/${facilityId}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!facilityId,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/facility-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facility_id: facilityId, date, slot, payment_method: payMethod }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: (data) => {
      router.replace(`/facilities/${data.id}/confirm` as never);
    },
    onError: () => Alert.alert('Error', 'Booking failed. Please try again.'),
  });

  const amountNGN = facility?.rate_kobo ? (facility.rate_kobo / 100).toLocaleString('en-NG') : '—';
  const dateLabel = date ? new Date(date as string).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '—';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Confirm Booking</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {/* Summary */}
        <View style={s.summaryCard}>
          <Text style={s.summaryTitle}>{facility?.name ?? 'Facility'}</Text>
          <View style={[s.summaryRow, s.rowBorder]}>
            <Text style={s.summaryLabel}>Date</Text>
            <Text style={s.summaryVal}>{dateLabel}</Text>
          </View>
          <View style={[s.summaryRow, s.rowBorder]}>
            <Text style={s.summaryLabel}>Time Slot</Text>
            <Text style={s.summaryVal}>{slot ?? '—'}</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Amount</Text>
            <Text style={[s.summaryVal, { color: colors.primary.DEFAULT, fontWeight: '800' }]}>₦{amountNGN}</Text>
          </View>
        </View>

        {/* Payment method */}
        <Text style={s.sectionLabel}>Payment Method</Text>
        {PAY_METHODS.map((pm) => (
          <Pressable key={pm.key} style={[s.payCard, payMethod === pm.key && s.payCardActive]} onPress={() => setPayMethod(pm.key)}>
            <View style={[s.payIcon, payMethod === pm.key && { backgroundColor: colors.primary.DEFAULT }]}>
              <Ionicons name={pm.icon} size={20} color={payMethod === pm.key ? '#fff' : colors.neutral.textMuted} />
            </View>
            <Text style={[s.payLabel, payMethod === pm.key && { color: colors.primary.DEFAULT, fontWeight: '700' }]}>{pm.label}</Text>
            {payMethod === pm.key && <Ionicons name="checkmark-circle" size={20} color={colors.primary.DEFAULT} />}
          </Pressable>
        ))}

        <Pressable style={[s.confirmBtn, mutation.isPending && { opacity: 0.6 }]} onPress={() => mutation.mutate()} disabled={mutation.isPending}>
          <Text style={s.confirmBtnTxt}>{mutation.isPending ? 'Processing…' : 'Confirm Booking'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  summaryCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  summaryTitle: { fontSize: 18, fontWeight: '700', color: colors.neutral.text, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  summaryLabel: { fontSize: 13, color: colors.neutral.textMuted },
  summaryVal: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  payCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: colors.neutral.border },
  payCardActive: { borderColor: colors.primary.DEFAULT, backgroundColor: colors.neutral.surfaceAlt },
  payIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  payLabel: { flex: 1, fontSize: 15, color: colors.neutral.text, fontWeight: '500' },
  confirmBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  confirmBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
