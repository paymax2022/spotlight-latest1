// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const MONTHLY = [
  { month: 'Jul', amount: 200000 }, { month: 'Aug', amount: 200000 }, { month: 'Sep', amount: 120000 },
  { month: 'Oct', amount: 200000 }, { month: 'Nov', amount: 200000 }, { month: 'Dec', amount: 120000 },
];
const PROPERTIES = [
  { unit: 'A1', type: 'Apartment', ytd: 1200000 },
  { unit: 'B3', type: 'Duplex', ytd: 960000 },
];
const maxAmt = Math.max(...MONTHLY.map(m => m.amount));

export default function PropertyIncome() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Income Report</Text>
        <Pressable style={styles.backBtn}>
          <Ionicons name="download-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Income YTD</Text>
          <Text style={styles.summaryAmount}>₦2,160,000</Text>
          <Text style={styles.summarySub}>Across 2 properties</Text>
        </View>

        <Text style={styles.sectionTitle}>Monthly Income</Text>
        <View style={styles.card}>
          <View style={styles.barChart}>
            {MONTHLY.map((m, i) => (
              <View key={i} style={styles.barItem}>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { height: `${(m.amount / maxAmt) * 100}%` }]} />
                </View>
                <Text style={styles.barLabel}>{m.month}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Per Property</Text>
        <View style={styles.card}>
          {PROPERTIES.map((p, i) => (
            <View key={i} style={[styles.propRow, i < PROPERTIES.length - 1 && styles.listBorder]}>
              <View style={styles.unitBadge}><Text style={styles.unitText}>{p.unit}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{p.type}</Text>
              </View>
              <Text style={styles.incomeAmount}>₦{p.ytd.toLocaleString()}</Text>
            </View>
          ))}
        </View>

        <View style={styles.taxCard}>
          <Ionicons name="information-circle-outline" size={18} color={colors.secondary.DEFAULT} />
          <View style={{ flex: 1 }}>
            <Text style={styles.taxTitle}>Tax Summary</Text>
            <Text style={styles.taxSub}>Consult a tax advisor for rental income obligations in Nigeria.</Text>
          </View>
        </View>

        <Pressable style={[styles.primaryBtn, { backgroundColor: '#C5A059' }]}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Export Report</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  summaryCard: { backgroundColor: '#7a5c1e', borderRadius: 16, padding: 20, gap: 4 },
  summaryLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  summaryAmount: { fontSize: 28, fontWeight: '800', color: '#fff' },
  summarySub: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', height: 120, padding: 16 },
  barItem: { alignItems: 'center', gap: 6, flex: 1 },
  barTrack: { width: 24, height: 90, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 6, justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: '#C5A059', borderRadius: 6 },
  barLabel: { fontSize: 11, color: colors.neutral.textMuted },
  propRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  unitBadge: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#C5A059', alignItems: 'center', justifyContent: 'center' },
  unitText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  incomeAmount: { fontSize: 15, fontWeight: '800', color: '#C5A059' },
  taxCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.secondary.DEFAULT + '10', borderRadius: 12, padding: 14 },
  taxTitle: { fontSize: 13, fontWeight: '700', color: colors.neutral.text },
  taxSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2, lineHeight: 18 },
  primaryBtn: { borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
