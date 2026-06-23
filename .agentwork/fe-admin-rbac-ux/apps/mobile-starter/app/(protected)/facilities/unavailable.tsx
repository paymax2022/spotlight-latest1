// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function FacilityUnavailableScreen() {
  const router = useRouter();
  const { reason, facility } = useLocalSearchParams();

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Unavailable</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.card}>
          <Ionicons name="close-circle" size={60} color="#9ca3af" />
          <Text style={s.title}>{facility ?? 'Facility'} Unavailable</Text>
          <Text style={s.sub}>This facility is temporarily unavailable for bookings.</Text>
          {reason ? (
            <View style={s.reasonBox}>
              <Text style={s.reasonLabel}>Reason</Text>
              <Text style={s.reasonTxt}>{reason}</Text>
            </View>
          ) : null}
        </View>
        <Pressable style={s.notifyBtn} onPress={() => Alert.alert('Subscribed', 'You will be notified when this facility becomes available.')}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary.DEFAULT} />
          <Text style={s.notifyBtnTxt}>Get Notified</Text>
        </Pressable>
        <Pressable style={s.backBtn} onPress={() => router.replace('/facilities' as never)}>
          <Text style={s.backBtnTxt}>Browse Other Facilities</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#6b7280' },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40, alignItems: 'center' },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 20, padding: 28, alignItems: 'center', gap: 12, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  title: { fontSize: 20, fontWeight: '700', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 22 },
  reasonBox: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12, width: '100%', gap: 4 },
  reasonLabel: { fontSize: 11, fontWeight: '700', color: colors.neutral.textMuted },
  reasonTxt: { fontSize: 13, color: colors.neutral.text },
  notifyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary.DEFAULT, width: '100%' },
  notifyBtnTxt: { color: colors.primary.DEFAULT, fontSize: 16, fontWeight: '700' },
  backBtn: { height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center', width: '100%' },
  backBtnTxt: { color: colors.neutral.text, fontSize: 16, fontWeight: '600' },
});
