// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function CancelBookingScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams();

  const { data: booking } = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: async () => {
      const res = await fetch(`/api/facility-bookings/${bookingId}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!bookingId,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/facility-bookings/${bookingId}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      Alert.alert('Cancelled', 'Your booking has been cancelled.', [{ text: 'OK', onPress: () => router.replace('/facilities/my-bookings' as never) }]);
    },
    onError: () => Alert.alert('Error', 'Cancellation failed.'),
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Cancel Booking</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.summaryCard}>
          <Text style={s.summaryTitle}>{booking?.facility_name ?? 'Facility'}</Text>
          <View style={[s.row, s.rowBorder]}>
            <Text style={s.label}>Date</Text>
            <Text style={s.val}>{booking?.date ? new Date(booking.date).toLocaleDateString('en-NG') : '—'}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.label}>Time</Text>
            <Text style={s.val}>{booking?.slot ?? '—'}</Text>
          </View>
        </View>

        <View style={s.policyCard}>
          <Ionicons name="information-circle-outline" size={20} color={colors.secondary.amber} />
          <Text style={s.policyTxt}>
            Cancellations made 24+ hours before the booking receive a full refund. Cancellations within 24 hours are non-refundable.
          </Text>
        </View>

        <Pressable
          style={[s.cancelBtn, mutation.isPending && { opacity: 0.6 }]}
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          <Text style={s.cancelBtnTxt}>{mutation.isPending ? 'Cancelling…' : 'Confirm Cancellation'}</Text>
        </Pressable>
        <Pressable style={s.keepBtn} onPress={() => router.back()}>
          <Text style={s.keepBtnTxt}>Keep Booking</Text>
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
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  val: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  policyCard: { flexDirection: 'row', gap: 10, backgroundColor: '#fef3c7', borderRadius: 12, padding: 14 },
  policyTxt: { flex: 1, fontSize: 13, color: '#92400e', lineHeight: 20 },
  cancelBtn: { backgroundColor: '#dc2626', borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  cancelBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  keepBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.neutral.border },
  keepBtnTxt: { color: colors.neutral.text, fontSize: 16, fontWeight: '600' },
});
