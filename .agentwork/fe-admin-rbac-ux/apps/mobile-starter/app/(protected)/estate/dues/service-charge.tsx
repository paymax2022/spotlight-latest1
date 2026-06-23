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

export default function ServiceChargeScreen() {
  const router = useRouter();

  const { data: history = [], isLoading } = useQuery<PaymentRecord[]>({
    queryKey: ['service-charge-history'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No estate');
      const res = await fetch(`/api/estate/${ctx.estateId}/dues/service-charge/history`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const breakdown = [
    { label: 'Pool Maintenance', amount: 80000 },
    { label: 'Gym Equipment', amount: 60000 },
    { label: 'Landscaping', amount: 50000 },
    { label: 'Common Area Cleaning', amount: 40000 },
    { label: 'Admin & Management', amount: 20000 },
  ];
  const total = breakdown.reduce((s, b) => s + b.amount, 0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Service Charge</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Property Type</Text>
            <Text style={styles.infoValue}>3 Bedroom Flat</Text>
          </View>
          <View style={[styles.infoRow, styles.listBorder]}>
            <Text style={styles.infoLabel}>Rate Basis</Text>
            <Text style={styles.infoValue}>Flat Rate</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Frequency</Text>
            <Text style={styles.infoValue}>Annual</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Charge Breakdown</Text>
        <View style={styles.card}>
          {breakdown.map((b, i) => (
            <View key={b.label} style={[styles.row, i < breakdown.length - 1 && styles.listBorder]}>
              <Text style={styles.listTitle}>{b.label}</Text>
              <Text style={styles.amount}>{fmt(b.amount)}</Text>
            </View>
          ))}
          <View style={[styles.row, { backgroundColor: colors.neutral.surfaceAlt }]}>
            <Text style={[styles.listTitle, { fontWeight: '700' }]}>Total</Text>
            <Text style={[styles.amount, { color: colors.primary.DEFAULT, fontWeight: '800' }]}>{fmt(total)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Payment History</Text>
        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} />
        ) : history.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="receipt-outline" size={36} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>No payment history yet</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {history.map((p, i) => (
              <View key={p.id} style={[styles.row, i < history.length - 1 && styles.listBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{p.description}</Text>
                  <Text style={styles.listSub}>{new Date(p.created_at).toLocaleDateString('en-NG')}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.amount}>{fmt(p.amount)}</Text>
                  <View style={[styles.badge, { backgroundColor: STATUS_BG[p.status] }]}>
                    <Text style={[styles.badgeText, { color: STATUS_COLORS[p.status] }]}>{p.status}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        <Pressable
          style={styles.primaryBtn}
          onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: total, description: 'Service Charge' } } as never)}
        >
          <Text style={styles.primaryBtnText}>Pay Now — {fmt(total)}</Text>
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
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  infoLabel: { fontSize: 13, color: colors.neutral.textMuted },
  infoValue: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
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
