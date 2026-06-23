// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const MOCK = {
  id: '1', name: 'James Okafor', phone: '+234 802 111 2222', email: 'james@example.com',
  unit: 'A1', leaseStart: 'Jan 2024', leaseEnd: 'Dec 2024', outstanding: 0,
  history: [
    { date: 'Dec 2024', amount: 120000, status: 'Paid' },
    { date: 'Nov 2024', amount: 120000, status: 'Paid' },
    { date: 'Oct 2024', amount: 120000, status: 'Paid' },
  ],
};

export default function TenantProfile() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const tenant = MOCK;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Tenant Profile</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{tenant.name.split(' ').map(n => n[0]).join('')}</Text></View>
          <Text style={styles.name}>{tenant.name}</Text>
          <Text style={styles.sub}>Unit {tenant.unit}</Text>
        </View>

        <View style={styles.card}>
          {[
            { label: 'Phone', value: tenant.phone },
            { label: 'Email', value: tenant.email },
            { label: 'Lease Start', value: tenant.leaseStart },
            { label: 'Lease End', value: tenant.leaseEnd },
          ].map((row, i) => (
            <View key={i} style={[styles.infoRow, i < 3 && styles.listBorder]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <Ionicons name="wallet-outline" size={20} color={tenant.outstanding > 0 ? colors.secondary.red : colors.secondary.emerald} />
          <View>
            <Text style={styles.listTitle}>Outstanding Balance</Text>
            <Text style={[styles.listSub, { color: tenant.outstanding > 0 ? colors.secondary.red : colors.secondary.emerald }]}>
              {tenant.outstanding > 0 ? `₦${tenant.outstanding.toLocaleString()}` : 'No outstanding dues'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Payment History</Text>
        <View style={styles.card}>
          {tenant.history.map((h, i) => (
            <View key={i} style={[styles.listRow, i < tenant.history.length - 1 && styles.listBorder]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.secondary.emerald} />
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{h.date}</Text>
              </View>
              <Text style={styles.payAmount}>₦{h.amount.toLocaleString()}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.actionBtn}>
            <Ionicons name="mail-outline" size={16} color={colors.secondary.DEFAULT} />
            <Text style={[styles.actionBtnText, { color: colors.secondary.DEFAULT }]}>Send Notice</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, { borderColor: colors.secondary.red + '50' }]}>
            <Text style={[styles.actionBtnText, { color: colors.secondary.red }]}>Approve Move-out</Text>
          </Pressable>
        </View>
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
  profileCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#C5A059' + '25', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatarText: { fontSize: 22, fontWeight: '800', color: '#C5A059' },
  name: { fontSize: 18, fontWeight: '700', color: colors.neutral.text },
  sub: { fontSize: 13, color: colors.neutral.textMuted },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  payAmount: { fontSize: 14, fontWeight: '700', color: colors.secondary.emerald },
  actionRow: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: colors.secondary.DEFAULT + '50', backgroundColor: colors.neutral.surface },
  actionBtnText: { fontSize: 14, fontWeight: '700' },
});
