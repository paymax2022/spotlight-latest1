// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const MOCK = {
  id: '1', unit: 'A1', type: 'Apartment', floor: '1st', size: '120 sqm',
  owner: 'James Okafor', tenant: 'Mary Johnson',
  paymentStatus: 'Paid', compliance: 'Compliant',
  docs: [{ name: 'Lease Agreement', date: 'Jan 2024' }, { name: 'Ownership Certificate', date: 'Mar 2022' }],
};

export default function PropertyDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const prop = MOCK;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Property {prop.unit}</Text>
        <Pressable style={styles.backBtn}>
          <Ionicons name="create-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {[
            { label: 'Unit', value: prop.unit },
            { label: 'Type', value: prop.type },
            { label: 'Floor', value: prop.floor },
            { label: 'Size', value: prop.size },
            { label: 'Owner', value: prop.owner },
            { label: 'Tenant', value: prop.tenant },
          ].map((row, i) => (
            <View key={i} style={[styles.infoRow, i < 5 && styles.listBorder]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { flexDirection: 'row', padding: 14, gap: 14 }]}>
          <View style={[styles.statusChip, { backgroundColor: colors.secondary.emerald + '15' }]}>
            <Ionicons name="card-outline" size={16} color={colors.secondary.emerald} />
            <Text style={[styles.statusText, { color: colors.secondary.emerald }]}>{prop.paymentStatus}</Text>
          </View>
          <View style={[styles.statusChip, { backgroundColor: colors.secondary.DEFAULT + '15' }]}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.secondary.DEFAULT} />
            <Text style={[styles.statusText, { color: colors.secondary.DEFAULT }]}>{prop.compliance}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Documents</Text>
        <View style={styles.card}>
          {prop.docs.map((doc, i) => (
            <View key={i} style={[styles.listRow, i < prop.docs.length - 1 && styles.listBorder]}>
              <Ionicons name="document-outline" size={20} color={colors.secondary.DEFAULT} />
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{doc.name}</Text>
                <Text style={styles.listSub}>{doc.date}</Text>
              </View>
              <Ionicons name="download-outline" size={18} color={colors.neutral.placeholder} />
            </View>
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
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  statusText: { fontSize: 13, fontWeight: '700' },
});
