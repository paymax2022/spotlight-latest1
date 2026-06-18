// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
interface PaymentRecord { id: string; reference: string; amount: number; status: 'success'|'failed'|'pending'; created_at: string; description: string; channel: string; }
const STATUS_COLORS = { success: '#059669', failed: '#dc2626', pending: '#f59e0b' };
const STATUS_BG = { success: '#f0fdf4', failed: '#fef2f2', pending: '#fffbeb' };

function groupByDate(records: PaymentRecord[]) {
  const map: Record<string, PaymentRecord[]> = {};
  records.forEach((r) => {
    const date = new Date(r.created_at).toDateString();
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const key = date === today ? 'Today' : date === yesterday ? 'Yesterday' : new Date(r.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
    if (!map[key]) map[key] = [];
    map[key].push(r);
  });
  return Object.entries(map).map(([date, items]) => ({ date, items }));
}

export default function PaymentHistoryScreen() {
  const router = useRouter();
  const { data: records = [], isLoading, refetch } = useQuery<PaymentRecord[]>({
    queryKey: ['dues-history'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      const res = await fetch(`/api/estate/${ctx.estateId}/dues/history`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const grouped = groupByDate(records);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Payment History</Text>
        <View style={{ width: 38 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
      ) : records.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="receipt-outline" size={48} color={colors.neutral.placeholder} />
          <Text style={styles.emptyText}>No payment history yet</Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(item) => item.date}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary.DEFAULT} />}
          renderItem={({ item: group }) => (
            <View style={{ gap: 8 }}>
              <Text style={styles.groupLabel}>{group.date}</Text>
              <View style={styles.card}>
                {group.items.map((p, i) => (
                  <Pressable
                    key={p.id}
                    style={[styles.row, i < group.items.length - 1 && styles.listBorder]}
                    onPress={() => router.push({ pathname: '/estate/dues/receipt/[id]', params: { id: p.reference } } as never)}
                  >
                    <View style={[styles.statusDot, { backgroundColor: STATUS_BG[p.status] }]}>
                      <Ionicons
                        name={p.status === 'success' ? 'checkmark' : p.status === 'failed' ? 'close' : 'time-outline'}
                        size={14}
                        color={STATUS_COLORS[p.status]}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.listTitle}>{p.description}</Text>
                      <Text style={styles.listSub}>{p.reference} · {p.channel}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.amount}>{fmt(p.amount)}</Text>
                      <View style={[styles.badge, { backgroundColor: STATUS_BG[p.status] }]}>
                        <Text style={[styles.badgeText, { color: STATUS_COLORS[p.status] }]}>{p.status}</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.neutral.placeholder} style={{ marginLeft: 4 }} />
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  list: { padding: 20, gap: 16 },
  groupLabel: { fontSize: 12, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  statusDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, marginTop: 4 },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  emptyCard: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
