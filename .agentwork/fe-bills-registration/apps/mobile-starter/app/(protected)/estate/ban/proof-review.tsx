// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const STEPS = [
  { label: 'Submitted', done: true },
  { label: 'Under Review', done: true, active: true },
  { label: 'Approved / Rejected', done: false },
];

export default function ProofReviewScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Proof Under Review</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.container}>
        <Ionicons name="time" size={64} color={colors.secondary.DEFAULT} />
        <Text style={styles.title}>Under Review</Text>
        <Text style={styles.sub}>Your proof of payment is being reviewed by the estate admin. This usually takes 1–2 hours.</Text>

        <View style={styles.trackerCard}>
          {STEPS.map((step, i) => (
            <View key={step.label} style={styles.trackerStep}>
              <View style={[styles.trackerDot, step.done && styles.trackerDotDone, step.active && styles.trackerDotActive]}>
                {step.done && !step.active && <Ionicons name="checkmark" size={12} color="#fff" />}
                {step.active && <View style={styles.activePulse} />}
              </View>
              <Text style={[styles.trackerLabel, step.active && styles.trackerLabelActive, step.done && !step.active && styles.trackerLabelDone]}>
                {step.label}
              </Text>
              {i < STEPS.length - 1 && <View style={[styles.trackerLine, step.done && styles.trackerLineDone]} />}
            </View>
          ))}
        </View>

        <Pressable style={styles.ghostBtn} onPress={() => router.push('/' as never)}>
          <Text style={styles.ghostBtnText}>Back to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { fontSize: 24, fontWeight: '700', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  trackerCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 20, width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  trackerStep: { alignItems: 'center', flex: 1, position: 'relative' },
  trackerDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  trackerDotDone: { backgroundColor: colors.secondary.emerald },
  trackerDotActive: { backgroundColor: colors.secondary.DEFAULT },
  activePulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  trackerLabel: { fontSize: 11, color: colors.neutral.textMuted, textAlign: 'center' },
  trackerLabelActive: { color: colors.secondary.DEFAULT, fontWeight: '700' },
  trackerLabelDone: { color: colors.secondary.emerald, fontWeight: '600' },
  trackerLine: { position: 'absolute', top: 14, left: '60%', right: '-40%', height: 2, backgroundColor: colors.neutral.border },
  trackerLineDone: { backgroundColor: colors.secondary.emerald },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.neutral.border },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
});
