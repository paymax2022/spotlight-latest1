// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const AMOUNT = 500000;
const SCHEDULE = ['Monday', 'Wednesday', 'Friday'];

export default function WasteScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Waste Disposal</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <View style={styles.iconWrap}><Ionicons name="trash-outline" size={32} color={colors.secondary.emerald} /></View>
          <Text style={styles.infoTitle}>Waste Disposal Levy</Text>
          <Text style={styles.infoAmount}>{fmt(AMOUNT)}<Text style={styles.infoFreq}>/mo</Text></Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Frequency</Text><Text style={styles.value}>Monthly</Text></View>
          <View style={[styles.row, styles.listBorder]}><Text style={styles.label}>Waste Company</Text><Text style={styles.value}>CleanCity Ltd.</Text></View>
          <View style={styles.row}><Text style={styles.label}>Bins Provided</Text><Text style={styles.value}>2 per unit</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Collection Schedule</Text>
        <View style={styles.card}>
          {SCHEDULE.map((day, i) => (
            <View key={day} style={[styles.row, i < SCHEDULE.length - 1 && styles.listBorder]}>
              <View style={styles.dayDot} />
              <Text style={[styles.listTitle, { marginLeft: 10 }]}>{day}</Text>
              <Text style={styles.timeText}>7:00 AM – 10:00 AM</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: AMOUNT, description: 'Waste Disposal Levy' } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Now — {fmt(AMOUNT)}</Text>
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
  infoCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center' },
  infoTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  infoAmount: { fontSize: 24, fontWeight: '800', color: colors.primary.DEFAULT },
  infoFreq: { fontSize: 14, fontWeight: '400', color: colors.neutral.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted, flex: 1 },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text, flex: 1 },
  timeText: { fontSize: 13, color: colors.neutral.textMuted },
  dayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.secondary.emerald },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
