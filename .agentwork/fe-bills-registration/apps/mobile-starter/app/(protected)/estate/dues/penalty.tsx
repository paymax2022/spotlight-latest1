// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const ORIGINAL = 1500000;
const DAYS_LATE = 15;
const DAILY_RATE = 10000;
const PENALTY = DAYS_LATE * DAILY_RATE;
const TOTAL = ORIGINAL + PENALTY;

export default function PenaltyScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Late Fee Details</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.policyCard}>
          <Ionicons name="information-circle-outline" size={24} color={colors.secondary.DEFAULT} />
          <Text style={styles.policyTitle}>Penalty Policy</Text>
          <Text style={styles.policyText}>A daily late fee of {fmt(DAILY_RATE)} is charged for each day a payment is overdue. This fee starts accumulating the day after the due date.</Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Original Amount</Text><Text style={styles.value}>{fmt(ORIGINAL)}</Text></View>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Days Late</Text><Text style={[styles.value, { color: colors.secondary.red }]}>{DAYS_LATE} days</Text></View>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Daily Rate</Text><Text style={styles.value}>{fmt(DAILY_RATE)}/day</Text></View>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Total Penalty</Text><Text style={[styles.value, { color: colors.secondary.red }]}>{fmt(PENALTY)}</Text></View>
          <View style={styles.row}>
            <Text style={[styles.label, { fontWeight: '700', color: colors.neutral.text }]}>Total Due</Text>
            <Text style={[styles.value, { color: colors.secondary.red, fontWeight: '800', fontSize: 18 }]}>{fmt(TOTAL)}</Text>
          </View>
        </View>

        <Pressable style={styles.disputeLink} onPress={() => router.push('/estate/dues/dispute' as never)}>
          <Ionicons name="chatbox-ellipses-outline" size={16} color={colors.secondary.DEFAULT} />
          <Text style={styles.disputeLinkText}>Dispute this penalty</Text>
        </Pressable>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: TOTAL, description: 'Security Levy + Late Fee' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Including Penalty — {fmt(TOTAL)}</Text>
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
  policyCard: { backgroundColor: '#eff6ff', borderRadius: 14, padding: 16, gap: 8 },
  policyTitle: { fontSize: 15, fontWeight: '700', color: colors.secondary.DEFAULT },
  policyText: { fontSize: 13, color: colors.secondary.DEFAULT, lineHeight: 20 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  disputeLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  disputeLinkText: { fontSize: 14, color: colors.secondary.DEFAULT, fontWeight: '600', textDecorationLine: 'underline' },
  primaryBtn: { backgroundColor: colors.secondary.red, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
