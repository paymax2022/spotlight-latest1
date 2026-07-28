// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

interface Decision { id: string; text: string; result: 'passed'|'deferred'|'rejected'; mover: string; seconder: string; }

const MOCK_DECISIONS: Decision[] = [
  { id: '1', text: 'Approve the 2025 annual budget of ₦15,000,000 for estate maintenance', result: 'passed', mover: 'Mr. Adebayo', seconder: 'Mrs. Okafor' },
  { id: '2', text: 'Postpone the security upgrade project to Q3 2025 pending vendor review', result: 'deferred', mover: 'Mr. Ibrahim', seconder: 'Ms. Chukwu' },
  { id: '3', text: 'Reject the proposal to increase parking charges by 50%', result: 'rejected', mover: 'Mrs. Johnson', seconder: 'Mr. Eze' },
];

const resultColors = { passed: colors.secondary.emerald, deferred: colors.secondary.amber, rejected: colors.secondary.red };
const resultIcons = { passed: 'checkmark-circle', deferred: 'time', rejected: 'close-circle' };

export default function MeetingDecisions() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();

  // In real impl: query decisions endpoint
  const decisions = MOCK_DECISIONS;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Decisions & Resolutions</Text>
        <View style={{ width: 38 }} />
      </View>

      <FlatList
        data={decisions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-done-outline" size={40} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>No decisions recorded</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.numBadge}>
                <Text style={styles.numText}>{index + 1}</Text>
              </View>
              <View style={[styles.resultBadge, { backgroundColor: resultColors[item.result] + '22' }]}>
                <Ionicons name={resultIcons[item.result] as any} size={14} color={resultColors[item.result]} />
                <Text style={[styles.resultText, { color: resultColors[item.result] }]}>{item.result}</Text>
              </View>
            </View>
            <Text style={styles.decisionText}>{item.text}</Text>
            <View style={styles.divider} />
            <View style={styles.moversRow}>
              <View style={styles.moverChip}>
                <Text style={styles.moverLabel}>Moved by</Text>
                <Text style={styles.moverName}>{item.mover}</Text>
              </View>
              <View style={styles.moverChip}>
                <Text style={styles.moverLabel}>Seconded by</Text>
                <Text style={styles.moverName}>{item.seconder}</Text>
              </View>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  listContent: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  numBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  numText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  resultBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  resultText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  decisionText: { fontSize: 14, color: colors.neutral.text, lineHeight: 22 },
  divider: { height: 1, backgroundColor: colors.neutral.border },
  moversRow: { flexDirection: 'row', gap: 12 },
  moverChip: { flex: 1, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 10 },
  moverLabel: { fontSize: 11, color: colors.neutral.textMuted, marginBottom: 2 },
  moverName: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10, marginTop: 20 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
