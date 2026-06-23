// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const ITEMS = [
  { id: '1', label: 'Security Levy', amount: 1500000, penalty: 120000, daysLate: 8 },
  { id: '2', label: 'Water Bill', amount: 750000, penalty: 75000, daysLate: 15 },
  { id: '3', label: 'Service Charge', amount: 2500000, penalty: 0, daysLate: 0 },
];

export default function OutstandingSummaryScreen() {
  const router = useRouter();
  const principal = ITEMS.reduce((s, i) => s + i.amount, 0);
  const penalties = ITEMS.reduce((s, i) => s + i.penalty, 0);
  const total = principal + penalties;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Outstanding Summary</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {ITEMS.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={[styles.row, styles.listBorder]}>
              <Text style={styles.cardTitle}>{item.label}</Text>
              {item.daysLate > 0 && <View style={styles.lateBadge}><Text style={styles.lateBadgeText}>{item.daysLate}d late</Text></View>}
            </View>
            <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Principal</Text><Text style={styles.value}>{fmt(item.amount)}</Text></View>
            {item.penalty > 0 && <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Late Fee</Text><Text style={[styles.value, { color: colors.secondary.red }]}>+{fmt(item.penalty)}</Text></View>}
            <View style={styles.row}><Text style={[styles.label, { fontWeight: '700', color: colors.neutral.text }]}>Subtotal</Text><Text style={[styles.value, { fontWeight: '700' }]}>{fmt(item.amount + item.penalty)}</Text></View>
          </View>
        ))}

        <View style={styles.totalCard}>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.totalLabel}>Principal Total</Text><Text style={styles.totalValue}>{fmt(principal)}</Text></View>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.totalLabel}>Total Penalties</Text><Text style={[styles.totalValue, { color: colors.secondary.red }]}>+{fmt(penalties)}</Text></View>
          <View style={styles.row}>
            <Text style={[styles.totalLabel, { fontSize: 16, color: colors.neutral.text, fontWeight: '800' }]}>Grand Total</Text>
            <Text style={[styles.totalValue, { fontSize: 22, color: colors.secondary.red }]}>{fmt(total)}</Text>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: total, description: 'All Outstanding Dues' } } as never)}>
          <Text style={styles.primaryBtnText}>Clear All Dues — {fmt(total)}</Text>
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  lateBadge: { backgroundColor: '#fef2f2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  lateBadgeText: { fontSize: 10, fontWeight: '700', color: colors.secondary.red },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  totalCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  totalLabel: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
  totalValue: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.secondary.red, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
