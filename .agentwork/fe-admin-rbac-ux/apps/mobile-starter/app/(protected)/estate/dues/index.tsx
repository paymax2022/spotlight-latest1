// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

interface EstateDue {
  id: string;
  title: string;
  amount: number;
  due_date: string;
  status: 'pending' | 'paid' | 'overdue' | 'partial';
  description?: string;
}

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

export default function DuesIndexScreen() {
  const router = useRouter();

  const { data: dues = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['estate-dues'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      const res = await fetch(`/api/estate/${ctx.estateId}/dues`);
      if (!res.ok) throw new Error('Failed to fetch dues');
      return res.json() as Promise<EstateDue[]>;
    },
  });

  const overdue = dues.filter((d) => d.status === 'overdue');
  const upcoming = dues.filter((d) => d.status === 'pending');
  const totalOwed = overdue.reduce((sum, d) => sum + d.amount, 0);
  const nextDue = upcoming[0];
  const lastPaid = dues
    .filter((d) => d.status === 'paid')
    .sort((a, b) => new Date(b.due_date).getTime() - new Date(a.due_date).getTime())[0];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Dues & Subscriptions</Text>
        <Pressable style={styles.backBtn} onPress={() => router.push('/estate/dues/history' as never)}>
          <Ionicons name="time-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
        ) : isError ? (
          <Pressable style={styles.errorCard} onPress={() => refetch()}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.secondary.red} />
            <Text style={styles.errorText}>Failed to load dues. Tap to retry.</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.statsBar}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: totalOwed > 0 ? colors.secondary.red : colors.secondary.emerald }]}>
                  {fmt(totalOwed)}
                </Text>
                <Text style={styles.statLabel}>Total Owed</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {nextDue ? new Date(nextDue.due_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : 'None'}
                </Text>
                <Text style={styles.statLabel}>Next Due</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {lastPaid ? new Date(lastPaid.due_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : 'Never'}
                </Text>
                <Text style={styles.statLabel}>Last Paid</Text>
              </View>
            </View>

            {overdue.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Outstanding Dues</Text>
                <View style={styles.card}>
                  {overdue.map((d, i) => (
                    <Pressable
                      key={d.id}
                      style={[styles.dueRow, i < overdue.length - 1 && styles.listBorder]}
                      onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: d.amount, description: d.title } } as never)}
                    >
                      <View style={styles.overdueBar} />
                      <View style={{ flex: 1, paddingLeft: 8 }}>
                        <Text style={styles.listTitle}>{d.title}</Text>
                        <Text style={styles.listSub}>Due: {new Date(d.due_date).toLocaleDateString('en-NG')}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.amount, { color: colors.secondary.red }]}>{fmt(d.amount)}</Text>
                        <View style={[styles.badge, { backgroundColor: '#fef2f2' }]}>
                          <Text style={[styles.badgeText, { color: colors.secondary.red }]}>Overdue</Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {upcoming.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Upcoming</Text>
                <View style={styles.card}>
                  {upcoming.map((d, i) => (
                    <Pressable
                      key={d.id}
                      style={[styles.dueRow, i < upcoming.length - 1 && styles.listBorder]}
                      onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: d.amount, description: d.title } } as never)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.listTitle}>{d.title}</Text>
                        <Text style={styles.listSub}>Due: {new Date(d.due_date).toLocaleDateString('en-NG')}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.amount, { color: colors.primary.DEFAULT }]}>{fmt(d.amount)}</Text>
                        <View style={[styles.badge, { backgroundColor: '#eff6ff' }]}>
                          <Text style={[styles.badgeText, { color: colors.secondary.DEFAULT }]}>Pending</Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Pressable style={styles.historyLink} onPress={() => router.push('/estate/dues/history' as never)}>
              <Ionicons name="receipt-outline" size={18} color={colors.primary.DEFAULT} />
              <Text style={styles.historyLinkText}>View Payment History</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.primary.DEFAULT} />
            </Pressable>

            {dues.length === 0 && (
              <View style={styles.emptyCard}>
                <Ionicons name="checkmark-circle-outline" size={48} color={colors.secondary.emerald} />
                <Text style={styles.emptyTitle}>All Clear!</Text>
                <Text style={styles.emptyText}>No outstanding dues at this time.</Text>
              </View>
            )}
            <View style={{ height: totalOwed > 0 ? 80 : 0 }} />
          </>
        )}
      </ScrollView>

      {totalOwed > 0 && !isLoading && (
        <View style={styles.fabContainer}>
          <Pressable
            style={styles.fab}
            onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: totalOwed, description: 'All Outstanding Dues' } } as never)}
          >
            <Ionicons name="wallet-outline" size={20} color="#fff" />
            <Text style={styles.fabText}>Pay All — {fmt(totalOwed)}</Text>
          </Pressable>
        </View>
      )}
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
  statsBar: { backgroundColor: colors.neutral.surface, borderRadius: 16, flexDirection: 'row', padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  statLabel: { fontSize: 11, color: colors.neutral.textMuted, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: colors.neutral.border },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  dueRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  overdueBar: { width: 4, alignSelf: 'stretch', backgroundColor: colors.secondary.red, borderRadius: 2 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, marginTop: 4 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  historyLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  historyLinkText: { fontSize: 14, fontWeight: '600', color: colors.primary.DEFAULT },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 28, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.secondary.emerald },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  errorCard: { backgroundColor: '#fef2f2', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorText: { fontSize: 13, color: colors.secondary.red },
  fabContainer: { position: 'absolute', bottom: 24, left: 20, right: 20 },
  fab: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: colors.primary.DEFAULT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
