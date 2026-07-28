import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, ChevronRight, CalendarClock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useTasks } from '@/features/tasks/hooks';
import { PRIORITY_META, TASK_STATUS_LABELS, TaskColors } from '@/features/tasks/api';
import type { EstateTask, TaskStatus } from '@/features/tasks/types';

const TABS: TaskStatus[] = ['todo', 'in_progress', 'done'];

export default function TasksScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useTasks();
  const [tab, setTab] = useState<TaskStatus>('todo');
  const filtered = useMemo(() => (data ?? []).filter((t) => t.status === tab), [data, tab]);

  const renderItem = ({ item }: { item: EstateTask }) => {
    const pr = PRIORITY_META[item.priority];
    const overdue = item.dueDate && item.status !== 'done' && +new Date(item.dueDate) < Date.now();
    return (
      <Pressable onPress={() => router.push(`/tasks/${item.id}`)} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={[styles.prDot, { backgroundColor: pr.color }]} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.tag, { backgroundColor: pr.bg }]}><Text style={[styles.tagText, { color: pr.color }]}>{pr.label}</Text></View>
            {item.dueDate ? (
              <View style={styles.metaItem}><CalendarClock size={12} color={overdue ? Colors.error : Colors.onSurfaceVariant} strokeWidth={1.8} /><Text style={[styles.metaText, overdue && { color: Colors.error }]}>{new Date(item.dueDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</Text></View>
            ) : null}
            {item.assigneeName ? <Text style={styles.metaText} numberOfLines={1}>· {item.assigneeName}</Text> : null}
          </View>
        </View>
        <ChevronRight size={18} color={Colors.outline} strokeWidth={1.8} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tasks" rightSlot={
        <Pressable onPress={() => router.push('/tasks/create')} accessibilityRole="button" accessibilityLabel="New task" hitSlop={8} style={styles.addBtn}><Plus size={22} color={Colors.secondary} strokeWidth={2.2} /></Pressable>
      } />
      <View style={styles.segment}>
        {TABS.map((t) => {
          const selected = t === tab;
          return (
            <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected }} style={[styles.segItem, selected && { backgroundColor: Colors.surfaceContainerLowest }]}>
              <Text style={[styles.segText, selected && { color: TaskColors[t].color }]}>{TASK_STATUS_LABELS[t]}</Text>
            </Pressable>
          );
        })}
      </View>
      {isLoading ? <StateView kind="loading" message="Loading tasks…" />
        : isError ? <StateView kind="error" title="Couldn't load tasks" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={filtered} keyExtractor={(t) => t.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={<StateView kind="empty" icon="ListChecks" title={`No ${TASK_STATUS_LABELS[tab].toLowerCase()} tasks`} message={tab === 'todo' ? 'Create a task for your committee.' : 'Nothing here yet.'} actionLabel={tab === 'todo' ? 'New task' : undefined} onAction={tab === 'todo' ? () => router.push('/tasks/create') : undefined} />} />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: 4, gap: 4 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.DEFAULT },
  segText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  pressed: { opacity: 0.85 },
  prDot: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, gap: 3 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  tag: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { ...Typography.labelSm, fontWeight: '700' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, maxWidth: 120 },
});
