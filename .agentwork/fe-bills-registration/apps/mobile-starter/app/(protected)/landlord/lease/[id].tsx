// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function LeaseView() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Lease Agreement</Text>
        <Pressable style={styles.backBtn}>
          <Ionicons name="download-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {[
            { label: 'Tenant', value: 'James Okafor' },
            { label: 'Property', value: 'Unit A1' },
            { label: 'Start Date', value: 'Jan 1, 2024' },
            { label: 'End Date', value: 'Dec 31, 2024' },
            { label: 'Monthly Rent', value: '₦120,000' },
          ].map((row, i) => (
            <View key={i} style={[styles.infoRow, i < 4 && styles.listBorder]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.badge, { alignSelf: 'flex-start', backgroundColor: colors.secondary.emerald + '20' }]}>
          <Ionicons name="checkmark-circle" size={14} color={colors.secondary.emerald} />
          <Text style={[styles.badgeText, { color: colors.secondary.emerald }]}>Signed by all parties</Text>
        </View>

        <View style={styles.docViewer}>
          <Ionicons name="document-text" size={48} color={colors.neutral.placeholder} />
          <Text style={styles.docText}>Lease Agreement PDF</Text>
          <Text style={styles.docSub}>Tap download to view full document</Text>
        </View>

        <Pressable style={[styles.primaryBtn, { backgroundColor: '#C5A059' }]}>
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Download Agreement</Text>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  docViewer: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 14, height: 160, alignItems: 'center', justifyContent: 'center', gap: 8 },
  docText: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  docSub: { fontSize: 12, color: colors.neutral.textMuted },
  primaryBtn: { borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
