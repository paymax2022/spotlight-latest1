// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const OVERDUE_ITEMS = [
  { id: '1', title: 'Water Bill', amount: 750000, daysLate: 15, penalty: 75000 },
  { id: '2', title: 'Security Levy', amount: 1500000, daysLate: 8, penalty: 120000 },
];

export default function OverdueScreen() {
  const router = useRouter();
  const totalPrincipal = OVERDUE_ITEMS.reduce((s, i) => s + i.amount, 0);
  const totalPenalty = OVERDUE_ITEMS.reduce((s, i) => s + i.penalty, 0);
  const totalOwed = totalPrincipal + totalPenalty;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Overdue Payments</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.redBanner}>
          <Ionicons name="warning" size={20} color="#fff" />
          <Text style={styles.redBannerText}>You have {OVERDUE_ITEMS.length} overdue payment{OVERDUE_ITEMS.length > 1 ? 's' : ''}. Late fees are accumulating daily.</Text>
        </View>

        {OVERDUE_ITEMS.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={[styles.row, styles.listBorder]}>
              <Text style={styles.listTitle}>{item.title}</Text>
              <View style={styles.overdueBadge}><Text style={styles.overdueBadgeText}>{item.daysLate} days late</Text></View>
            </View>
            <View style={[styles.row, styles.listBorder]}>
              <Text style={styles.label}>Principal</Text>
              <Text style={styles.value}>{fmt(item.amount)}</Text>
            </View>
            <View style={[styles.row, styles.listBorder]}>
              <Text style={styles.label}>Late Fee</Text>
              <Text style={[styles.value, { color: colors.secondary.red }]}>+{fmt(item.penalty)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.label, { fontWeight: '700', color: colors.neutral.text }]}>Total Due</Text>
              <Text style={[styles.value, { color: colors.secondary.red, fontWeight: '800', fontSize: 16 }]}>{fmt(item.amount + item.penalty)}</Text>
            </View>
          </View>
        ))}

        <View style={styles.summaryCard}>
          <View style={styles.row}><Text style={styles.summaryLabel}>Principal Total</Text><Text style={styles.summaryValue}>{fmt(totalPrincipal)}</Text></View>
          <View style={styles.row}><Text style={styles.summaryLabel}>Total Penalties</Text><Text style={[styles.summaryValue, { color: colors.secondary.red }]}>+{fmt(totalPenalty)}</Text></View>
          <View style={[styles.row, { borderTopWidth: 2, borderTopColor: colors.secondary.red }]}>
            <Text style={[styles.summaryLabel, { fontWeight: '700', color: colors.neutral.text }]}>Total Owed</Text>
            <Text style={[styles.summaryValue, { color: colors.secondary.red, fontSize: 20 }]}>{fmt(totalOwed)}</Text>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: totalOwed, description: 'All Overdue Payments + Penalties' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay All Now — {fmt(totalOwed)}</Text>
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
  redBanner: { backgroundColor: colors.secondary.red, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  redBannerText: { color: '#fff', fontSize: 14, flex: 1, lineHeight: 20 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  overdueBadge: { backgroundColor: '#fef2f2', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  overdueBadgeText: { fontSize: 11, fontWeight: '700', color: colors.secondary.red },
  summaryCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  summaryLabel: { fontSize: 14, color: colors.neutral.textMuted },
  summaryValue: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.secondary.red, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
