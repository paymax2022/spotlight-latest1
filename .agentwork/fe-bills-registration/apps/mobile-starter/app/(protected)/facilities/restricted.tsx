// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function FacilityRestrictedScreen() {
  const router = useRouter();
  const { amount_kobo } = useLocalSearchParams();
  const amount = amount_kobo ? (Number(amount_kobo) / 100).toLocaleString('en-NG') : '0.00';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Restricted</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.lockCard}>
          <Ionicons name="lock-closed" size={60} color="#dc2626" />
          <Text style={s.lockTitle}>Facility Unavailable</Text>
          <Text style={s.lockSub}>This facility is unavailable due to outstanding dues on your account.</Text>
          <View style={s.amountBadge}>
            <Text style={s.amountLabel}>Outstanding Amount</Text>
            <Text style={s.amountVal}>₦{amount}</Text>
          </View>
        </View>
        <Pressable style={s.payBtn} onPress={() => router.push('/estate/dues' as never)}>
          <Ionicons name="card-outline" size={20} color="#fff" />
          <Text style={s.payBtnTxt}>Pay Dues</Text>
        </Pressable>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnTxt}>Go Back</Text>
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
  content: { padding: 20, gap: 16, paddingBottom: 40, alignItems: 'center' },
  lockCard: { backgroundColor: colors.neutral.surface, borderRadius: 20, padding: 28, alignItems: 'center', gap: 12, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  lockTitle: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  lockSub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 22 },
  amountBadge: { backgroundColor: '#fee2e2', borderRadius: 12, padding: 14, alignItems: 'center', width: '100%' },
  amountLabel: { fontSize: 12, color: '#991b1b', fontWeight: '600' },
  amountVal: { fontSize: 28, fontWeight: '800', color: '#dc2626', marginTop: 4 },
  payBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' },
  payBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  backBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.neutral.border },
  backBtnTxt: { color: colors.neutral.text, fontSize: 16, fontWeight: '600' },
});
