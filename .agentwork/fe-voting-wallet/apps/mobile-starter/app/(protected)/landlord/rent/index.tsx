// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const BREAKDOWN = [
  { unit: 'A1', tenant: 'James Okafor', expected: 120000, collected: 120000 },
  { unit: 'B3', tenant: 'Amaka Eze', expected: 80000, collected: 0 },
];

export default function RentCollection() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Rent Collection</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Collected this Month</Text>
          <Text style={styles.summaryAmount}>₦120,000</Text>
          <Text style={styles.summaryTarget}>of ₦200,000 expected</Text>
          <View style={styles.progressTrack}><View style={[styles.progressBar, { width: '60%' }]} /></View>
        </View>
        <Text style={styles.sectionTitle}>Per Property</Text>
        {BREAKDOWN.map((b, i) => (
          <View key={i} style={styles.propCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>Unit {b.unit} · {b.tenant}</Text>
              <Text style={styles.listSub}>Expected: ₦{b.expected.toLocaleString()}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.amount, { color: b.collected > 0 ? colors.secondary.emerald : colors.secondary.red }]}>
                ₦{b.collected.toLocaleString()}
              </Text>
              <Text style={styles.listSub}>{b.collected > 0 ? 'Paid' : 'Unpaid'}</Text>
            </View>
          </View>
        ))}
        <Pressable style={[styles.primaryBtn, { backgroundColor: '#C5A059' }]}>
          <Ionicons name="megaphone-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Send Reminders</Text>
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
  summaryTarget: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  progressTrack: { height: 8, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 4, marginTop: 10 },
  progressBar: { height: 8, backgroundColor: '#C5A059', borderRadius: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  propCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '800' },
  primaryBtn: { borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
