import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, CalendarClock, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { useTasks } from '@/features/association/hooks/useEngagement';
import { dueLabel } from '@/features/association/utils/associationFormatters';
import { TASK_SEGMENTS, TASK_STATUS_STYLE, TASK_PRIORITY_STYLE } from '@/features/association/constants/engagement.constants';
import type { TaskScope, TaskSummary } from '@/features/association/types/engagement.types';

export default function TasksDashboard() {
  const [scope, setScope] = useState<string>('mine');
  const tasks = useTasks(scope as TaskScope);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tasks" />
      <View style={styles.segWrap}>
        <SegmentedControl options={TASK_SEGMENTS as never} value={scope} onChange={setScope} />
      </View>

      {tasks.isLoading ? (
        <StateView kind="loading" message="Loading tasks…" />
      ) : tasks.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => tasks.refetch()} />
      ) : (tasks.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="ListTodo" title="No tasks" message={scope === 'overdue' ? 'Nothing overdue — nice work.' : 'Tasks assigned to you appear here.'} />
      ) : (
        <FlatList
          data={tasks.data ?? []}
          keyExtractor={(t) => t.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => <TaskCard task={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function TaskCard({ task: t }: { task: TaskSummary }) {
  const status = TASK_STATUS_STYLE[t.status];
  const priority = TASK_PRIORITY_STYLE[t.priority];
  const overdue = t.status === 'OVERDUE';
  return (
    <Pressable
      onPress={() => router.push(`/association/tasks/${t.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${t.title}, ${status.label}`}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.title} numberOfLines={2}>{t.title}</Text>
        <View style={styles.badgeRow}>
          <View style={[styles.pill, { backgroundColor: status.bg }]}>
            <View style={[styles.dot, { backgroundColor: status.color }]} />
            <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: priority.bg }]}>
            <Text style={[styles.pillText, { color: priority.color }]}>{priority.label}</Text>
          </View>
        </View>
        <View style={styles.metaRow}>
          {t.dueDate ? (
            <View style={styles.metaItem}>
              <CalendarClock size={13} color={overdue ? Colors.error : Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={[styles.meta, overdue && styles.metaOverdue]}>{dueLabel(t.dueDate)}</Text>
            </View>
          ) : null}
          {t.committee ? (
            <View style={styles.metaItem}>
              <Users size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.meta}>{t.committee}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  segWrap: { paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  pressed: { opacity: 0.9 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  badgeRow: { flexDirection: 'row', gap: Spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  pillText: { ...Typography.caption, fontWeight: '600' as const },
  metaRow: { flexDirection: 'row', gap: Spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaOverdue: { color: Colors.error, fontWeight: '600' as const },
});
