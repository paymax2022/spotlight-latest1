// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listTasks } from '@/api/tasks.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const TABS = ['My Tasks', 'Assigned', 'Created'];
const priorityColors = { low: colors.secondary.DEFAULT, medium: colors.secondary.amber, high: colors.secondary.red };
const statusColors = { todo: colors.secondary.DEFAULT, in_progress: colors.secondary.amber, done: colors.secondary.emerald, overdue: colors.secondary.red };

export default function TasksIndex() {
  const router = useRouter();
  const { estateId } = getActiveEstateContext();
  const [activeTab, setActiveTab] = useState(0);

  const filterMap = ['my', 'assigned', 'created'];

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['tasks', estateId, filterMap[activeTab]],
    queryFn: () => listTasks(estateId, filterMap[activeTab]),
    staleTime: 30_000,
  });

  const tasks = data ?? [];
  const todoCt = tasks.filter(t => t.status === 'todo').length;
  const inProgressCt = tasks.filter(t => t.status === 'in_progress').length;
  const doneCt = tasks.filter(t => t.status === 'done').length;
  const overdueCt = tasks.filter(t => t.status === 'overdue').length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Tasks</Text>
        <Pressable style={styles.backBtn} onPress={() => router.push('/tasks/calendar' as never)}>
          <Ionicons name="calendar-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        {[
          { label: 'To Do', count: todoCt, color: colors.secondary.DEFAULT },
          { label: 'In Progress', count: inProgressCt, color: colors.secondary.amber },
          { label: 'Done', count: doneCt, color: colors.secondary.emerald },
          { label: 'Overdue', count: overdueCt, color: colors.secondary.red },
        ].map(s => (
          <View key={s.label} style={[styles.statCard, { borderColor: s.color }]}>
            <Text style={[styles.statNum, { color: s.color }]}>{s.count}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.tabRow}>
        {TABS.map((t, i) => (
          <Pressable key={t} style={[styles.tab, activeTab === i && styles.tabActive]} onPress={() => setActiveTab(i)}>
            <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>Failed to load tasks</Text>
            <Pressable style={styles.retryBtn} onPress={() => refetch()}><Text style={styles.retryText}>Retry</Text></Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary.DEFAULT} />}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Ionicons name="clipboard-outline" size={40} color={colors.neutral.placeholder} />
              <Text style={styles.emptyText}>No tasks yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/tasks/${item.id}` as never)}>
              <View style={styles.cardRow}>
                <View style={styles.avatarInitials}>
                  <Text style={styles.avatarText}>{(item.assignee_name ?? '?').charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskTitle}>{item.title}</Text>
                  {item.due_date ? <Text style={styles.dueDate}>Due {item.due_date}</Text> : null}
                </View>
                <View style={styles.badgeCol}>
                  <View style={[styles.badge, { backgroundColor: priorityColors[item.priority] + '22' }]}>
                    <Text style={[styles.badgeText, { color: priorityColors[item.priority] }]}>{item.priority}</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: statusColors[item.status] + '22', marginTop: 4 }]}>
                    <Text style={[styles.badgeText, { color: statusColors[item.status] }]}>{item.status.replace('_', ' ')}</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/tasks/create' as never)}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  statsRow: { flexDirection: 'row', gap: 8, padding: 12 },
  statCard: { flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1 },
  statNum: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 10, color: colors.neutral.textMuted, marginTop: 1, textAlign: 'center' },
  tabRow: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, padding: 4, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: colors.primary.DEFAULT },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  tabTextActive: { color: '#fff' },
  listContent: { padding: 16, gap: 10, paddingBottom: 80 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  avatarInitials: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary.DEFAULT + '22', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', color: colors.primary.DEFAULT },
  taskTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  dueDate: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badgeCol: { alignItems: 'flex-end' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  emptyCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 40, alignItems: 'center', gap: 10, marginTop: 20 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorCard: { backgroundColor: '#fee2e2', borderRadius: 14, padding: 20, alignItems: 'center', gap: 10 },
  errorText: { color: colors.secondary.red, fontWeight: '600' },
  retryBtn: { backgroundColor: colors.secondary.red, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
});
