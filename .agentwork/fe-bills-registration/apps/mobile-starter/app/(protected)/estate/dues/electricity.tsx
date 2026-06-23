// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const UNITS = 340;
const RATE_PER_UNIT = 10000;
const TOTAL = UNITS * RATE_PER_UNIT;

export default function ElectricityScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Electricity Levy</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <View style={styles.iconWrap}><Ionicons name="flash-outline" size={32} color={colors.secondary.amber} /></View>
          <Text style={styles.infoTitle}>Common Area Electricity</Text>
          <Text style={styles.infoAmount}>{fmt(TOTAL)}</Text>
          <Text style={styles.infoSub}>Generator + Street Lighting</Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Units This Month</Text>
            <Text style={styles.value}>{UNITS} kWh</Text>
          </View>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Rate per Unit</Text>
            <Text style={styles.value}>{fmt(RATE_PER_UNIT)}/kWh</Text>
          </View>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Coverage</Text>
            <Text style={styles.value}>Common Areas + Gate</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Generator Diesel</Text>
            <Text style={styles.value}>Included</Text>
          </View>
        </View>

        <View style={styles.calcCard}>
          <View style={styles.calcRow}><Text style={styles.calcLabel}>Units</Text><Text style={styles.calcValue}>{UNITS} kWh</Text></View>
          <View style={styles.calcRow}><Text style={styles.calcLabel}>× Rate</Text><Text style={styles.calcValue}>{fmt(RATE_PER_UNIT)}</Text></View>
          <View style={[styles.calcRow, { paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.neutral.border }]}>
            <Text style={[styles.calcLabel, { fontWeight: '700', color: colors.neutral.text }]}>Total</Text>
            <Text style={[styles.calcValue, { color: colors.primary.DEFAULT, fontSize: 18 }]}>{fmt(TOTAL)}</Text>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: TOTAL, description: 'Electricity Levy' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Now — {fmt(TOTAL)}</Text>
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
  infoCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  infoTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  infoAmount: { fontSize: 28, fontWeight: '800', color: colors.primary.DEFAULT },
  infoSub: { fontSize: 12, color: colors.neutral.textMuted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  calcCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  calcRow: { flexDirection: 'row', justifyContent: 'space-between' },
  calcLabel: { fontSize: 14, color: colors.neutral.textMuted },
  calcValue: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
