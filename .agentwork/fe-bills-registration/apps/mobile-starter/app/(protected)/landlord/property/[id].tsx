// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const MOCK = {
  id: '1', unit: 'A1', type: 'Apartment', tenant: 'James Okafor',
  leaseStart: 'Jan 2024', leaseEnd: 'Dec 2024', rent: 120000,
  maintenanceCount: 2, docs: [{ name: 'Lease Agreement', date: 'Jan 2024' }],
};

export default function PropertyDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const prop = MOCK;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Unit {prop.unit}</Text>
        <Pressable style={styles.backBtn}>
          <Ionicons name="create-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {[
            { label: 'Type', value: prop.type },
            { label: 'Tenant', value: prop.tenant },
            { label: 'Lease Start', value: prop.leaseStart },
            { label: 'Lease End', value: prop.leaseEnd },
            { label: 'Monthly Rent', value: `₦${prop.rent.toLocaleString()}` },
          ].map((row, i) => (
            <View key={i} style={[styles.infoRow, i < 4 && styles.listBorder]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.maintenanceCard} onPress={() => {}}>
          <Ionicons name="construct-outline" size={20} color={colors.secondary.amber} />
          <View style={{ flex: 1 }}>
            <Text style={styles.listTitle}>Maintenance Requests</Text>
            <Text style={styles.listSub}>{prop.maintenanceCount} active requests</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
        </Pressable>

        <Text style={styles.sectionTitle}>Documents</Text>
        <View style={styles.card}>
          {prop.docs.map((doc, i) => (
            <View key={i} style={styles.listRow}>
              <Ionicons name="document-outline" size={20} color={colors.secondary.DEFAULT} />
              <Text style={[styles.listTitle, { flex: 1 }]}>{doc.name}</Text>
              <Ionicons name="download-outline" size={18} color={colors.neutral.placeholder} />
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <Pressable style={styles.actionBtn} onPress={() => router.push(`/landlord/tenant/${id}` as never)}>
            <Text style={styles.actionBtnText}>View Tenant</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, { backgroundColor: '#C5A059' }]}>
            <Text style={[styles.actionBtnText, { color: '#fff' }]}>Edit Property</Text>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  maintenanceCard: { backgroundColor: colors.secondary.amber + '10', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  actionRow: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, borderRadius: 14, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutral.surfaceAlt, borderWidth: 1, borderColor: colors.neutral.border },
  actionBtnText: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
});
