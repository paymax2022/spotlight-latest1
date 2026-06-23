// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const AMOUNT = 5000000;

const COVERED = [
  { icon: 'water-outline', label: 'Swimming Pool Maintenance' },
  { icon: 'fitness-outline', label: 'Gym Equipment Servicing' },
  { icon: 'leaf-outline', label: 'Gardens & Landscaping' },
  { icon: 'shield-outline', label: 'Estate Roads Repair' },
  { icon: 'home-outline', label: 'Clubhouse Maintenance' },
  { icon: 'bulb-outline', label: 'Lighting Infrastructure' },
];

export default function FacilityMaintenanceScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Facility Maintenance</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <View style={styles.iconWrap}><Ionicons name="build-outline" size={32} color="#8B5CF6" /></View>
          <Text style={styles.infoTitle}>Annual Facility Levy</Text>
          <Text style={styles.infoAmount}>{fmt(AMOUNT)}</Text>
          <Text style={styles.infoSub}>Covers all shared amenities for the year</Text>
        </View>

        <Text style={styles.sectionTitle}>What's Covered</Text>
        <View style={styles.card}>
          {COVERED.map((item, i) => (
            <View key={item.label} style={[styles.row, i < COVERED.length - 1 && styles.listBorder]}>
              <View style={styles.iconCircle}><Ionicons name={item.icon as any} size={18} color={colors.primary.DEFAULT} /></View>
              <Text style={styles.listTitle}>{item.label}</Text>
              <Ionicons name="checkmark-circle" size={18} color={colors.secondary.emerald} />
            </View>
          ))}
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: AMOUNT, description: 'Facility Maintenance Levy' } } as never)}>
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
  infoCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f5f3ff', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  infoTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  infoAmount: { fontSize: 28, fontWeight: '800', color: colors.primary.DEFAULT },
  infoSub: { fontSize: 12, color: colors.neutral.textMuted, textAlign: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text, flex: 1 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
