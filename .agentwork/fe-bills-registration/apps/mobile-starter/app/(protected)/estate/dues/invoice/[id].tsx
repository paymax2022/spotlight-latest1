// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

interface InvoiceItem { description: string; amount: number; }
interface Invoice { id: string; invoice_number: string; date: string; estate_name: string; items: InvoiceItem[]; status: 'paid'|'unpaid'|'partial'; total: number; }

const STATUS_COLORS = { paid: '#059669', unpaid: '#dc2626', partial: '#f59e0b' };
const STATUS_BG = { paid: '#f0fdf4', unpaid: '#fef2f2', partial: '#fffbeb' };

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: invoice, isLoading, isError } = useQuery<Invoice>({
    queryKey: ['invoice', id],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      const res = await fetch(`/api/estate/${ctx.estateId}/invoices/${id}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Invoice</Text>
        <Pressable style={styles.backBtn} onPress={() => Alert.alert('Share', 'Share functionality coming soon')}>
          <Ionicons name="share-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
        ) : isError || !invoice ? (
          <View style={styles.emptyCard}><Ionicons name="alert-circle-outline" size={36} color={colors.secondary.red} /><Text style={styles.emptyText}>Could not load invoice</Text></View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.invoiceHeader}>
                <View style={styles.logoPlaceholder}><Text style={styles.logoText}>PAYMAX</Text></View>
                <View style={[styles.badge, { backgroundColor: STATUS_BG[invoice.status] }]}>
                  <Text style={[styles.badgeText, { color: STATUS_COLORS[invoice.status] }]}>{invoice.status.toUpperCase()}</Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Invoice No.</Text><Text style={styles.metaValue}>{invoice.invoice_number}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Date</Text><Text style={styles.metaValue}>{new Date(invoice.date).toLocaleDateString('en-NG')}</Text></View>
              <View style={styles.metaRow}><Text style={styles.metaLabel}>Estate</Text><Text style={styles.metaValue}>{invoice.estate_name}</Text></View>
            </View>

            <View style={styles.card}>
              <View style={[styles.tableHeader, styles.listBorder]}>
                <Text style={[styles.tableHead, { flex: 2 }]}>Description</Text>
                <Text style={[styles.tableHead, { textAlign: 'right' }]}>Amount</Text>
              </View>
              {invoice.items.map((item, i) => (
                <View key={i} style={[styles.tableRow, i < invoice.items.length - 1 && styles.listBorder]}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>{item.description}</Text>
                  <Text style={[styles.tableCell, { textAlign: 'right', fontWeight: '600' }]}>{fmt(item.amount)}</Text>
                </View>
              ))}
              <View style={[styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{fmt(invoice.total)}</Text>
              </View>
            </View>

            <View style={{ gap: 10 }}>
              {invoice.status !== 'paid' && (
                <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: invoice.total, description: `Invoice ${invoice.invoice_number}` } } as never)}>
                  <Text style={styles.primaryBtnText}>Pay Invoice — {fmt(invoice.total)}</Text>
                </Pressable>
              )}
              <Pressable style={styles.ghostBtn} onPress={() => Alert.alert('Download', 'PDF download coming soon')}>
                <Ionicons name="download-outline" size={18} color={colors.primary.DEFAULT} />
                <Text style={styles.ghostBtnText}>Download PDF</Text>
              </Pressable>
            </View>
          </>
        )}
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, padding: 16 },
  invoiceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  logoPlaceholder: { backgroundColor: colors.primary.DEFAULT, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  logoText: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.neutral.border, marginBottom: 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  metaLabel: { fontSize: 13, color: colors.neutral.textMuted },
  metaValue: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  tableHeader: { flexDirection: 'row', paddingBottom: 10 },
  tableHead: { fontSize: 12, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingVertical: 10 },
  tableCell: { fontSize: 14, color: colors.neutral.text },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, marginTop: 4, borderTopWidth: 2, borderTopColor: colors.primary.DEFAULT },
  totalLabel: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  totalValue: { fontSize: 18, fontWeight: '800', color: colors.primary.DEFAULT },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 28, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
});
