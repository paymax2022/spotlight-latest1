// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const MONTHLY = [
  { month: 'Jul', pct: 0.7 }, { month: 'Aug', pct: 0.85 }, { month: 'Sep', pct: 0.6 },
  { month: 'Oct', pct: 0.9 }, { month: 'Nov', pct: 0.75 }, { month: 'Dec', pct: 0.55 },
];
const CATEGORIES = [
  { name: 'Service Charge', collected: 420000, target: 480000 },
  { name: 'Security Levy', collected: 180000, target: 200000 },
  { name: 'Waste Management', collected: 90000, target: 100000 },
  { name: 'Facility Maintenance', collected: 60000, target: 80000 },
];

export default function PaymentReport() {
  const router = useRouter();
  const total = 750000, target = 860000;
  const pct = Math.round((total / target) * 100);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Revenue Report</Text>
        <Pressable style={styles.backBtn}>
          <Ionicons name="download-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Collected</Text>
          <Text style={styles.summaryAmount}>₦{total.toLocaleString()}</Text>
          <Text style={styles.summaryTarget}>of ₦{target.toLocaleString()} target ({pct}%)</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${pct}%` }]} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Monthly Breakdown</Text>
        <View style={styles.card}>
          <View style={styles.barChart}>
            {MONTHLY.map((m, i) => (
              <View key={i} style={styles.barItem}>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { height: `${m.pct * 100}%` }]} />
                </View>
                <Text style={styles.barLabel}>{m.month}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Category Breakdown</Text>
        <View style={styles.card}>
          {CATEGORIES.map((cat, i) => (
            <View key={i} style={[styles.catRow, i < CATEGORIES.length - 1 && styles.listBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{cat.name}</Text>
                <Text style={styles.listSub}>₦{cat.collected.toLocaleString()} / ₦{cat.target.toLocaleString()}</Text>
              </View>
              <Text style={[styles.catPct, { color: (cat.collected / cat.target) > 0.8 ? colors.secondary.emerald : colors.secondary.amber }]}>
                {Math.round((cat.collected / cat.target) * 100)}%
              </Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.primaryBtn}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Export Report</Text>
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
  summaryCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 16, padding: 20, gap: 4 },
  summaryLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  summaryAmount: { fontSize: 28, fontWeight: '800', color: '#fff' },
  summaryTarget: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  progressTrack: { height: 8, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 4, marginTop: 10 },
  progressBar: { height: 8, backgroundColor: '#fff', borderRadius: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', height: 120, padding: 16 },
  barItem: { alignItems: 'center', gap: 6, flex: 1 },
  barTrack: { width: 24, height: 90, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 6, justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.primary.DEFAULT, borderRadius: 6 },
  barLabel: { fontSize: 11, color: colors.neutral.textMuted },
  catRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  catPct: { fontSize: 16, fontWeight: '800' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
