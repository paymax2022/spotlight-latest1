// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const RATINGS = ['Excellent', 'Good', 'Fair', 'Poor'];
const AREAS = [
  { area: 'Kitchen', rating: 'Good' },
  { area: 'Bathroom', rating: 'Excellent' },
  { area: 'Living Room', rating: 'Good' },
  { area: 'Exterior', rating: 'Fair' },
];
const ratingColor = (r: string) => {
  if (r === 'Excellent') return colors.secondary.emerald;
  if (r === 'Good') return colors.secondary.DEFAULT;
  if (r === 'Fair') return colors.secondary.amber;
  return colors.secondary.red;
};

export default function InspectionReport() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Inspection Report</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {[
            { label: 'Date', value: 'Dec 10, 2024' },
            { label: 'Inspector', value: 'Emeka Chukwu' },
            { label: 'Property', value: 'Unit A1' },
          ].map((row, i) => (
            <View key={i} style={[styles.infoRow, i < 2 && styles.listBorder]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Condition Ratings</Text>
        <View style={styles.card}>
          {AREAS.map((a, i) => (
            <View key={i} style={[styles.listRow, i < AREAS.length - 1 && styles.listBorder]}>
              <Text style={[styles.listTitle, { flex: 1 }]}>{a.area}</Text>
              <View style={[styles.badge, { backgroundColor: ratingColor(a.rating) + '20' }]}>
                <Text style={[styles.badgeText, { color: ratingColor(a.rating) }]}>{a.rating}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Photos</Text>
        <View style={styles.photoRow}>
          {[1, 2, 3].map(i => (
            <View key={i} style={styles.photoBox}>
              <Ionicons name="image-outline" size={28} color={colors.neutral.placeholder} />
            </View>
          ))}
        </View>

        <View style={styles.notesCard}>
          <Text style={styles.notesLabel}>Inspector Notes</Text>
          <Text style={styles.notesText}>General condition is satisfactory. Exterior wall shows minor weathering. Recommend repainting within 6 months.</Text>
        </View>

        <View style={styles.notesCard}>
          <Text style={styles.notesLabel}>Recommendations</Text>
          <Text style={styles.notesText}>1. Touch up exterior paint. 2. Service kitchen sink tap. 3. Replace bathroom door handle.</Text>
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
  listRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBox: { flex: 1, height: 90, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.neutral.border, borderStyle: 'dashed' },
  notesCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, gap: 6 },
  notesLabel: { fontSize: 13, fontWeight: '700', color: colors.neutral.textMuted },
  notesText: { fontSize: 13, color: colors.neutral.text, lineHeight: 20 },
});
