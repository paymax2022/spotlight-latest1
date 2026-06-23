// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

interface ActionItem { id: string; task: string; assignee: string; due_date: string; status: 'open'|'done'; }

const MOCK_ACTIONS: ActionItem[] = [
  { id: '1', task: 'Obtain quotes from 3 security vendors', assignee: 'Mr. Adebayo', due_date: '2025-02-15', status: 'open' },
  { id: '2', task: 'Circulate minutes to all residents', assignee: 'Secretary', due_date: '2025-01-25', status: 'done' },
  { id: '3', task: 'Review and update estate bye-laws', assignee: 'Legal Committee', due_date: '2025-03-01', status: 'open' },
];

export default function MeetingActions() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();

  const actions = MOCK_ACTIONS;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Action Items</Text>
        <View style={{ width: 38 }} />
      </View>

      <FlatList
        data={actions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="hammer-outline" size={40} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>No action items recorded</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/tasks` as never)}>
            <View style={styles.cardRow}>
              <View style={[styles.statusDot, { backgroundColor: item.status === 'done' ? colors.secondary.emerald : colors.secondary.amber }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.taskText}>{item.task}</Text>
                <View style={styles.metaRow}>
                  <Ionicons name="person-outline" size={13} color={colors.neutral.textMuted} />
                  <Text style={styles.metaText}>{item.assignee}</Text>
                  <Ionicons name="calendar-outline" size={13} color={colors.neutral.textMuted} />
                  <Text style={styles.metaText}>{item.due_date}</Text>
                </View>
              </View>
              <View style={[styles.badge, { backgroundColor: item.status === 'done' ? colors.secondary.emerald + '22' : colors.secondary.amber + '22' }]}>
                <Text style={[styles.badgeText, { color: item.status === 'done' ? colors.secondary.emerald : colors.secondary.amber }]}>{item.status}</Text>
              </View>
            </View>
          </Pressable>
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
  listContent: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  taskText: { fontSize: 14, fontWeight: '600', color: colors.neutral.text, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  metaText: { fontSize: 12, color: colors.neutral.textMuted, marginRight: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10, marginTop: 20 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
