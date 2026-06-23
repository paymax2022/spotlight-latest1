// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getTask, updateTaskStatus } from '@/api/tasks.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const STATUSES = ['todo', 'in_progress', 'done', 'overdue'] as const;
const priorityColors = { low: colors.secondary.DEFAULT, medium: colors.secondary.amber, high: colors.secondary.red };
const statusColors = { todo: colors.secondary.DEFAULT, in_progress: colors.secondary.amber, done: colors.secondary.emerald, overdue: colors.secondary.red };
const statusLabels = { todo: 'To Do', in_progress: 'In Progress', done: 'Done', overdue: 'Overdue' };

export default function TaskDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = getActiveEstateContext();
  const qc = useQueryClient();

  const { data: task, isLoading, isError, refetch } = useQuery({
    queryKey: ['task', id, estateId],
    queryFn: () => getTask(id, estateId),
    staleTime: 30_000,
  });

  const statusMut = useMutation({
    mutationFn: (status: string) => updateTaskStatus(id, estateId, status),
    onSuccess: () => {
      Alert.alert('Success', 'Task status updated');
      qc.invalidateQueries({ queryKey: ['task', id, estateId] });
      qc.invalidateQueries({ queryKey: ['tasks', estateId] });
    },
    onError: () => Alert.alert('Error', 'Failed to update status'),
  });

  if (isLoading) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Task Detail</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.DEFAULT} /></View>
    </SafeAreaView>
  );

  if (isError || !task) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Task Detail</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.centered}>
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>Failed to load task</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Task Detail</Text>
        <Pressable style={styles.backBtn} onPress={() => router.push(`/tasks/${id}/edit` as never)}>
          <Ionicons name="pencil-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        {task.description ? <Text style={styles.description}>{task.description}</Text> : null}

        <View style={styles.chipsRow}>
          <View style={[styles.chip, { backgroundColor: priorityColors[task.priority] + '22' }]}>
            <Ionicons name="flag-outline" size={14} color={priorityColors[task.priority]} />
            <Text style={[styles.chipText, { color: priorityColors[task.priority] }]}>{task.priority} priority</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: statusColors[task.status] + '22' }]}>
            <Text style={[styles.chipText, { color: statusColors[task.status] }]}>{statusLabels[task.status]}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Ionicons name="person-outline" size={16} color={colors.neutral.textMuted} />
            <Text style={styles.infoLabel}>Assignee</Text>
            <Text style={styles.infoValue}>{task.assignee_name ?? 'Unassigned'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Ionicons name="create-outline" size={16} color={colors.neutral.textMuted} />
            <Text style={styles.infoLabel}>Created by</Text>
            <Text style={styles.infoValue}>{task.created_by_name}</Text>
          </View>
          {task.due_date ? (
            <>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={16} color={colors.neutral.textMuted} />
                <Text style={styles.infoLabel}>Due date</Text>
                <Text style={styles.infoValue}>{task.due_date}</Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Update Status</Text>
          <View style={styles.statusChips}>
            {STATUSES.map(s => (
              <Pressable
                key={s}
                style={[styles.statusChip, task.status === s && { backgroundColor: statusColors[s], borderColor: statusColors[s] }]}
                onPress={() => statusMut.mutate(s)}
                disabled={statusMut.isPending || task.status === s}
              >
                <Text style={[styles.statusChipText, task.status === s && { color: '#fff' }]}>{statusLabels[s]}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Comments</Text>
          <Pressable style={styles.navRow} onPress={() => router.push(`/tasks/${id}/comments` as never)}>
            <Ionicons name="chatbubbles-outline" size={20} color={colors.primary.DEFAULT} />
            <Text style={styles.navText}>View Comments</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Activity Log</Text>
          <View style={styles.activityPlaceholder}>
            <Text style={styles.placeholderText}>Task created · Status updates · Comments</Text>
          </View>
        </View>

        <Pressable
          style={styles.dangerBtn}
          onPress={() => Alert.alert('Delete Task', 'Are you sure you want to delete this task?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => router.back() },
          ])}
        >
          <Ionicons name="trash-outline" size={18} color={colors.secondary.red} />
          <Text style={styles.dangerText}>Delete Task</Text>
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
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  taskTitle: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  description: { fontSize: 15, color: colors.neutral.text, lineHeight: 24 },
  chipsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  chipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { fontSize: 13, color: colors.neutral.textMuted, flex: 1 },
  infoValue: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  divider: { height: 1, backgroundColor: colors.neutral.border, marginVertical: 10 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  statusChips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statusChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface },
  statusChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, textTransform: 'capitalize' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14 },
  navText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  activityPlaceholder: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14 },
  placeholderText: { fontSize: 13, color: colors.neutral.textMuted },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.secondary.red + '10', borderRadius: 14, height: 50, borderWidth: 1, borderColor: colors.secondary.red + '30' },
  dangerText: { fontSize: 15, fontWeight: '600', color: colors.secondary.red },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorCard: { backgroundColor: '#fee2e2', borderRadius: 14, padding: 20, alignItems: 'center', gap: 10 },
  errorText: { color: colors.secondary.red, fontWeight: '600' },
  retryBtn: { backgroundColor: colors.secondary.red, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: '#fff', fontWeight: '700' },
});
