// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const STEPS = [
  { label: 'Documents Uploaded', status: 'done' },
  { label: 'Under Review', status: 'active' },
  { label: 'Verification Complete', status: 'pending' },
];

export default function VendorVerify() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Verification Status</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusCard}>
          <Ionicons name="hourglass" size={48} color={colors.secondary.amber} />
          <Text style={styles.statusTitle}>Under Review</Text>
          <Text style={styles.statusSub}>Your documents have been submitted and are being reviewed by our team.</Text>
          <View style={styles.etaChip}>
            <Text style={styles.etaText}>Estimated review: 1–2 business days</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Progress</Text>
        {STEPS.map((s, i) => (
          <View key={i} style={styles.progressStep}>
            <View style={[styles.stepDot, s.status === 'done' && styles.stepDotDone, s.status === 'active' && styles.stepDotActive]}>
              {s.status === 'done' && <Ionicons name="checkmark" size={14} color="#fff" />}
              {s.status === 'active' && <View style={styles.activeDot} />}
            </View>
            <Text style={[styles.stepLabel, s.status === 'active' && { color: colors.primary.DEFAULT, fontWeight: '700' }]}>{s.label}</Text>
          </View>
        ))}

        <Pressable style={styles.supportBtn}>
          <Ionicons name="chatbubble-outline" size={18} color={colors.secondary.DEFAULT} />
          <Text style={styles.supportBtnText}>Contact Support</Text>
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
  statusCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 28, alignItems: 'center', gap: 10, shadowColor: '#000', shadowOpacity: 0.06, elevation: 3 },
  statusTitle: { fontSize: 20, fontWeight: '800', color: colors.neutral.text },
  statusSub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 20 },
  etaChip: { backgroundColor: colors.secondary.amber + '20', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  etaText: { fontSize: 12, fontWeight: '600', color: colors.secondary.amber },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  progressStep: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: colors.secondary.emerald },
  stepDotActive: { backgroundColor: colors.primary.DEFAULT },
  activeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  stepLabel: { fontSize: 14, color: colors.neutral.textMuted },
  supportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.secondary.DEFAULT },
  supportBtnText: { fontSize: 15, fontWeight: '700', color: colors.secondary.DEFAULT },
});
