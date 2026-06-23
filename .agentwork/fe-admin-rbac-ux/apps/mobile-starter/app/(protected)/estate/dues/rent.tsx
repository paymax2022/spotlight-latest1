// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
interface PaymentRecord { id: string; reference: string; amount: number; status: 'success'|'failed'|'pending'; created_at: string; description: string; channel: string; }
const STATUS_COLORS = { success: '#059669', failed: '#dc2626', pending: '#f59e0b' };
const STATUS_BG = { success: '#f0fdf4', failed: '#fef2f2', pending: '#fffbeb' };

export default function RentScreen() {
  const router = useRouter();
  const { data: history = [], isLoading } = useQuery<PaymentRecord[]>({
    queryKey: ['rent-history'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      const res = await fetch(`/api/estate/${ctx.estateId}/rent/history`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const RENT = 25000000;
  const LANDLORD = 'Mr. Emeka Okafor';
  const DUE_DATE = '1st of every month';
  const LEASE_START = '2024-01-01';
  const LEASE_END = '2025-12-31';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Rent</Text>
        <Pressable style={styles.backBtn} onPress={() => router.push('/estate/dues/rent-schedule' as never)}>
          <Ionicons name="calendar-outline" size={22} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.rentCard}>
          <Text style={styles.rentLabel}>Monthly Rent</Text>
          <Text style={styles.rentAmount}>{fmt(RENT)}</Text>
          <Text style={styles.rentSub}>Due: {DUE_DATE}</Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Landlord</Text><Text style={styles.value}>{LANDLORD}</Text></View>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Lease Start</Text><Text style={styles.value}>{new Date(LEASE_START).toLocaleDateString('en-NG')}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Lease End</Text><Text style={styles.value}>{new Date(LEASE_END).toLocaleDateString('en-NG')}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Payment History</Text>
        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} />
        ) : history.length === 0 ? (
          <View style={styles.emptyCard}><Ionicons name="receipt-outline" size={36} color={colors.neutral.placeholder} /><Text style={styles.emptyText}>No payment history yet</Text></View>
        ) : (
          <View style={styles.card}>
            {history.map((p, i) => (
              <View key={p.id} style={[styles.row, i < history.length - 1 && styles.listBorder]}>
                <View style={{ flex: 1 }}><Text style={styles.listTitle}>{p.description}</Text><Text style={styles.listSub}>{new Date(p.created_at).toLocaleDateString('en-NG')}</Text></View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.amount}>{fmt(p.amount)}</Text>
                  <View style={[styles.badge, { backgroundColor: STATUS_BG[p.status] }]}><Text style={[styles.badgeText, { color: STATUS_COLORS[p.status] }]}>{p.status}</Text></View>
                </View>
              </View>
            ))}
          </View>
        )}

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: RENT, description: 'Monthly Rent' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Rent — {fmt(RENT)}</Text>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  rentCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 16, padding: 24, alignItems: 'center', gap: 4 },
  rentLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  rentAmount: { fontSize: 32, fontWeight: '800', color: '#fff' },
  rentSub: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, marginTop: 4 },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 28, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
