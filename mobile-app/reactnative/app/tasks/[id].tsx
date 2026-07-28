import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { CalendarClock, User, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { PRIORITY_META, TASK_STATUS_LABELS, TaskColors } from '@/features/tasks/api';
import { useTask, useUpdateTaskStatus } from '@/features/tasks/hooks';
import type { TaskStatus } from '@/features/tasks/types';

const FLOW: TaskStatus[] = ['todo', 'in_progress', 'done'];

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useTask(id ?? '');
  const update = useUpdateTaskStatus();

  if (task.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Task" /><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  if (task.isError || !task.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Task" /><StateView kind="error" title="Task unavailable" message="Couldn't load this task." actionLabel="Retry" onAction={() => task.refetch()} /></SafeAreaView>;

  const t = task.data;
  const pr = PRIORITY_META[t.priority];
  const sc = TaskColors[t.status];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Task" rightSlot={<View style={[styles.chip, { backgroundColor: sc.bg }]}><Text style={[styles.chipText, { color: sc.color }]}>{TASK_STATUS_LABELS[t.status]}</Text></View>} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t.title}</Text>
        <View style={styles.tagRow}>
          <View style={[styles.tag, { backgroundColor: pr.bg }]}><Text style={[styles.tagText, { color: pr.color }]}>{pr.label} priority</Text></View>
        </View>
        <View style={styles.card}>
          {t.dueDate ? <Row icon={<CalendarClock size={16} color={Colors.onSurfaceVariant} />} label="Due" value={new Date(t.dueDate).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} /> : null}
          <Row icon={<User size={16} color={Colors.onSurfaceVariant} />} label="Assignee" value={t.assigneeName ?? 'Unassigned'} />
        </View>
        {t.description ? <View style={styles.card}><Text style={styles.cardTitle}>Description</Text><Text style={styles.desc}>{t.description}</Text></View> : null}

        <Text style={styles.sectionLabel}>Update status</Text>
        <View style={styles.statusRow}>
          {FLOW.map((s) => {
            const selected = t.status === s; const c = TaskColors[s];
            return (
              <Pressable key={s} onPress={() => update.mutate({ taskId: t.id, status: s })} disabled={update.isPending || selected} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.statusBtn, selected && { backgroundColor: c.color, borderColor: c.color }]}>
                {selected ? <CheckCircle2 size={15} color={Colors.onPrimary} strokeWidth={2} /> : null}
                <Text style={[styles.statusText, selected ? { color: Colors.onPrimary } : { color: c.color }]}>{TASK_STATUS_LABELS[s]}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <View style={styles.row}><View style={styles.rowLabel}>{icon}<Text style={styles.rowLabelText}>{label}</Text></View><Text style={styles.rowValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  tagRow: { flexDirection: 'row', gap: Spacing.sm },
  tag: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { ...Typography.labelSm, fontWeight: '700' },
  chip: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.sm, ...shadow1 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowLabelText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  statusRow: { flexDirection: 'row', gap: Spacing.sm },
  statusBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 46, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  statusText: { ...Typography.labelMd },
});
