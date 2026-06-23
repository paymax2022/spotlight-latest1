// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const PAYOUTS = [
  { id: '1', date: 'Dec 10, 2024', amount: 45000, status: 'Paid' },
  { id: '2', date: 'Nov 28, 2024', amount: 30000, status: 'Paid' },
];

export default function VendorEarnings() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Earnings</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.balanceCard}>
          <View>
            <Text style={styles.balLabel}>Available Balance</Text>
            <Text style={styles.balAmount}>₦45,000</Text>
          </View>
          <View style={styles.divider} />
          <View>
            <Text style={styles.balLabel}>Pending</Text>
            <Text style={styles.pendingAmt}>₦20,000</Text>
          </View>
        </View>

        <View style={styles.monthCard}>
          <Ionicons name="trending-up" size={20} color={colors.secondary.emerald} />
          <View style={{ flex: 1 }}>
            <Text style={styles.monthLabel}>This Month</Text>
            <Text style={styles.monthAmount}>₦75,000</Text>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push('/vendor/earnings/payout' as never)}>
          <Ionicons name="arrow-up-circle" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Request Payout</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Payout History</Text>
        <View style={styles.card}>
          {PAYOUTS.map((p, i) => (
            <View key={p.id} style={[styles.listRow, i < PAYOUTS.length - 1 && styles.listBorder]}>
              <View style={styles.payIcon}><Ionicons name="checkmark-circle" size={18} color={colors.secondary.emerald} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>Payout</Text>
                <Text style={styles.listSub}>{p.date}</Text>
              </View>
              <Text style={styles.payAmount}>₦{p.amount.toLocaleString()}</Text>
            </View>
          ))}
        </View>
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
  balanceCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 16, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 20 },
  balLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  balAmount: { fontSize: 26, fontWeight: '800', color: '#fff' },
  divider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.3)' },
  pendingAmt: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  monthCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.secondary.emerald + '15', borderRadius: 14, padding: 14 },
  monthLabel: { fontSize: 13, color: colors.neutral.textMuted },
  monthAmount: { fontSize: 18, fontWeight: '800', color: colors.secondary.emerald },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  payIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.secondary.emerald + '15', alignItems: 'center', justifyContent: 'center' },
  payAmount: { fontSize: 15, fontWeight: '800', color: colors.secondary.emerald },
});
