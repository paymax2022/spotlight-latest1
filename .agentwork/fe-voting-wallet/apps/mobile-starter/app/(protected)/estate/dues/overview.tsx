// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

interface DueCategory {
  id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'annual' | 'quarterly';
  status: 'pending' | 'paid' | 'overdue' | 'partial';
  path: string;
}

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const CATEGORIES: DueCategory[] = [
  { id: 'security', name: 'Security Levy', amount: 1500000, frequency: 'monthly', status: 'pending', path: '/estate/dues/security-levy' },
  { id: 'waste', name: 'Waste Disposal', amount: 500000, frequency: 'monthly', status: 'paid', path: '/estate/dues/waste' },
  { id: 'water', name: 'Water Bill', amount: 750000, frequency: 'monthly', status: 'overdue', path: '/estate/dues/water' },
  { id: 'facility', name: 'Facility Maintenance', amount: 5000000, frequency: 'annual', status: 'pending', path: '/estate/dues/facility-maintenance' },
  { id: 'service', name: 'Service Charge', amount: 2500000, frequency: 'annual', status: 'partial', path: '/estate/dues/service-charge' },
];

const STATUS_COLORS = { pending: '#f59e0b', paid: '#059669', overdue: '#dc2626', partial: '#0051d5' };
const STATUS_BG = { pending: '#fffbeb', paid: '#f0fdf4', overdue: '#fef2f2', partial: '#eff6ff' };
const FREQ_LABEL = { monthly: '/mo', annual: '/yr', quarterly: '/qtr' };

export default function DuesOverviewScreen() {
  const router = useRouter();

  const totalAnnual = CATEGORIES.reduce((sum, c) => {
    const multiplier = c.frequency === 'monthly' ? 12 : c.frequency === 'quarterly' ? 4 : 1;
    return sum + c.amount * multiplier;
  }, 0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Dues Overview</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Annual Commitment</Text>
          <Text style={styles.summaryAmount}>{fmt(totalAnnual)}</Text>
          <Text style={styles.summaryNote}>Across all due categories</Text>
        </View>

        <Text style={styles.sectionTitle}>Due Categories</Text>
        <View style={styles.card}>
          {CATEGORIES.map((cat, i) => (
            <Pressable
              key={cat.id}
              style={[styles.row, i < CATEGORIES.length - 1 && styles.listBorder]}
              onPress={() => router.push(cat.path as never)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{cat.name}</Text>
                <Text style={styles.listSub}>{cat.frequency.charAt(0).toUpperCase() + cat.frequency.slice(1)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={styles.amount}>{fmt(cat.amount)}<Text style={styles.freq}>{FREQ_LABEL[cat.frequency]}</Text></Text>
                <View style={[styles.badge, { backgroundColor: STATUS_BG[cat.status] }]}>
                  <Text style={[styles.badgeText, { color: STATUS_COLORS[cat.status] }]}>{cat.status}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} style={{ marginLeft: 6 }} />
            </Pressable>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  summaryCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 16, padding: 20, alignItems: 'center', gap: 4 },
  summaryLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  summaryAmount: { fontSize: 28, fontWeight: '800', color: '#fff' },
  summaryNote: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  freq: { fontSize: 11, fontWeight: '400', color: colors.neutral.textMuted },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
});
