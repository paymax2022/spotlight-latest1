// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const EXPIRY = new Date(Date.now() + 12 * 86400000).toISOString();
const daysLeft = Math.ceil((new Date(EXPIRY).getTime() - Date.now()) / 86400000);
const PLAN_AMOUNT = 1500000;

export default function RenewalScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Renew Subscription</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.expiryCard}>
          <Ionicons name="calendar-outline" size={32} color={daysLeft <= 7 ? colors.secondary.red : colors.secondary.amber} />
          <Text style={styles.expiryTitle}>Your subscription expires in</Text>
          <Text style={[styles.daysNumber, { color: daysLeft <= 7 ? colors.secondary.red : colors.secondary.amber }]}>{daysLeft}</Text>
          <Text style={styles.daysLabel}>days</Text>
          <Text style={styles.expiryDate}>{new Date(EXPIRY).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Current Plan</Text><Text style={styles.value}>Monthly</Text></View>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Amount</Text><Text style={[styles.value, { color: colors.primary.DEFAULT, fontWeight: '700' }]}>{fmt(PLAN_AMOUNT)}/mo</Text></View>
          <View style={styles.row}><Text style={styles.label}>Next Billing</Text><Text style={styles.value}>{new Date(EXPIRY).toLocaleDateString('en-NG')}</Text></View>
        </View>

        <View style={styles.promoBanner}>
          <Ionicons name="pricetag-outline" size={16} color="#fff" />
          <Text style={styles.promoText}>Switch to Annual and save 15%! — {fmt(15300000)}/yr</Text>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: PLAN_AMOUNT, description: 'Monthly Subscription Renewal' } } as never)}>
          <Text style={styles.primaryBtnText}>Renew Now — {fmt(PLAN_AMOUNT)}</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={() => router.push('/estate/dues/plans' as never)}>
          <Text style={styles.ghostBtnText}>View Plans</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  expiryCard: { backgroundColor: colors.neutral.surface, borderRadius: 20, padding: 28, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  expiryTitle: { fontSize: 14, color: colors.neutral.textMuted, marginTop: 8 },
  daysNumber: { fontSize: 64, fontWeight: '800', lineHeight: 72 },
  daysLabel: { fontSize: 16, color: colors.neutral.textMuted },
  expiryDate: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 4 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  promoBanner: { backgroundColor: colors.secondary.emerald, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  promoText: { fontSize: 13, fontWeight: '600', color: '#fff', flex: 1 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
});
