// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const PROPERTIES_PREVIEW = [
  { unit: 'A1', type: 'Apartment', tenant: 'James Okafor', status: 'Paid' },
  { unit: 'B3', type: 'Duplex', tenant: 'Amaka Eze', status: 'Overdue' },
  { unit: 'C7', type: 'Shop', tenant: '', status: 'Vacant' },
];
const UPCOMING = [
  { tenant: 'James Okafor', amount: 120000, date: 'Jan 1' },
  { tenant: 'Amaka Eze', amount: 80000, date: 'Jan 5' },
];

export default function LandlordDashboard() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Properties</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statsRow}>
          {[
            { label: 'Properties', value: '3', icon: 'business' },
            { label: 'Active Tenants', value: '2', icon: 'people' },
            { label: 'Collected (Dec)', value: '₦200K', icon: 'cash' },
          ].map((s, i) => (
            <View key={i} style={styles.statCard}>
              <Ionicons name={s.icon as any} size={20} color={'#C5A059'} />
              <Text style={styles.statNum}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Properties</Text>
          <Pressable onPress={() => router.push('/landlord/properties' as never)}>
            <Text style={styles.seeAll}>See All</Text>
          </Pressable>
        </View>
        {PROPERTIES_PREVIEW.map((p, i) => (
          <View key={i} style={styles.propCard}>
            <View style={styles.unitBadge}><Text style={styles.unitText}>{p.unit}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{p.type}</Text>
              <Text style={styles.listSub}>{p.tenant || 'Vacant'}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: p.status === 'Paid' ? colors.secondary.emerald + '20' : p.status === 'Overdue' ? colors.secondary.red + '20' : colors.neutral.surfaceAlt }]}>
              <Text style={[styles.badgeText, { color: p.status === 'Paid' ? colors.secondary.emerald : p.status === 'Overdue' ? colors.secondary.red : colors.neutral.textMuted }]}>{p.status}</Text>
            </View>
          </View>
        ))}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Upcoming Collections</Text>
        </View>
        <View style={styles.card}>
          {UPCOMING.map((u, i) => (
            <View key={i} style={[styles.listRow, i < UPCOMING.length - 1 && styles.listBorder]}>
              <Ionicons name="calendar" size={18} color={'#C5A059'} />
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{u.tenant}</Text>
                <Text style={styles.listSub}>Due {u.date}</Text>
              </View>
              <Text style={styles.rentAmount}>₦{u.amount.toLocaleString()}</Text>
            </View>
          ))}
        </View>

        <Pressable style={[styles.primaryBtn, { backgroundColor: '#C5A059' }]} onPress={() => router.push('/landlord/tenants' as never)}>
          <Text style={styles.primaryBtnText}>Tenant Requests</Text>
          <View style={styles.requestBadge}><Text style={styles.requestBadgeText}>2</Text></View>
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
  content: { padding: 20, gap: 14 },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 12, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  statNum: { fontSize: 18, fontWeight: '800', color: colors.neutral.text },
  statLabel: { fontSize: 11, color: colors.neutral.textMuted, textAlign: 'center' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  seeAll: { fontSize: 13, fontWeight: '600', color: '#C5A059' },
  propCard: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  unitBadge: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#C5A059', alignItems: 'center', justifyContent: 'center' },
  unitText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  rentAmount: { fontSize: 15, fontWeight: '800', color: '#C5A059' },
  primaryBtn: { borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  requestBadge: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  requestBadgeText: { fontSize: 12, fontWeight: '800', color: '#C5A059' },
});
