// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function BookingConfirmScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();

  const { data: booking } = useQuery({
    queryKey: ['booking', id],
    queryFn: async () => {
      const res = await fetch(`/api/facility-bookings/${id}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const handleShare = async () => {
    try {
      await Share.share({
        message: `I just booked ${booking?.facility_name ?? 'a facility'} on ${booking?.date ? new Date(booking.date).toLocaleDateString('en-NG') : ''} at ${booking?.slot ?? ''}. Ref: ${booking?.reference ?? id}`,
      });
    } catch {}
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.replace('/facilities' as never)}><Ionicons name="home-outline" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Booking Confirmed</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.successIcon}>
          <Ionicons name="checkmark-circle" size={80} color="#16a34a" />
        </View>
        <Text style={s.successTitle}>Booking Confirmed!</Text>

        {/* QR placeholder */}
        <View style={s.qrBox}>
          <Ionicons name="qr-code-outline" size={80} color={colors.neutral.textMuted} />
          <Text style={s.qrLabel}>Show at entrance</Text>
        </View>

        <View style={s.card}>
          <View style={[s.infoRow, s.rowBorder]}>
            <Text style={s.infoLabel}>Reference</Text>
            <Text style={s.infoVal}>{booking?.reference ?? String(id).slice(0, 8).toUpperCase()}</Text>
          </View>
          <View style={[s.infoRow, s.rowBorder]}>
            <Text style={s.infoLabel}>Facility</Text>
            <Text style={s.infoVal}>{booking?.facility_name ?? '—'}</Text>
          </View>
          <View style={[s.infoRow, s.rowBorder]}>
            <Text style={s.infoLabel}>Date</Text>
            <Text style={s.infoVal}>{booking?.date ? new Date(booking.date).toLocaleDateString('en-NG') : '—'}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Time</Text>
            <Text style={s.infoVal}>{booking?.slot ?? '—'}</Text>
          </View>
        </View>

        <View style={s.actionsRow}>
          <Pressable style={s.calBtn} onPress={() => {}}>
            <Ionicons name="calendar-outline" size={18} color={colors.primary.DEFAULT} />
            <Text style={s.calBtnTxt}>Add to Calendar</Text>
          </Pressable>
          <Pressable style={s.shareBtn} onPress={handleShare}>
            <Ionicons name="share-outline" size={18} color="#fff" />
            <Text style={s.shareBtnTxt}>Share</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40, alignItems: 'center' },
  successIcon: { marginTop: 8 },
  successTitle: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  qrBox: { width: 180, height: 180, borderRadius: 16, backgroundColor: colors.neutral.surface, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8 },
  qrLabel: { fontSize: 12, color: colors.neutral.textMuted },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  infoLabel: { fontSize: 13, color: colors.neutral.textMuted },
  infoVal: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  actionsRow: { flexDirection: 'row', gap: 12, width: '100%' },
  calBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  calBtnTxt: { color: colors.primary.DEFAULT, fontWeight: '700' },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 12, backgroundColor: colors.primary.DEFAULT },
  shareBtnTxt: { color: '#fff', fontWeight: '700' },
});
