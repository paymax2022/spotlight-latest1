import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { CheckSquare, Square, CalendarClock, Users, User, ScrollText, MessageSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useTask, useUpdateTaskStatus } from '@/features/association/hooks/useEngagement';
import { dueLabel, relativeTime } from '@/features/association/utils/associationFormatters';
import { TASK_STATUS_STYLE, TASK_PRIORITY_STYLE } from '@/features/association/constants/engagement.constants';
import type { TaskStatus } from '@/features/association/types/engagement.types';

// Next status in the simple member-side progression.
const NEXT_STATUS: Partial<Record<TaskStatus, { to: TaskStatus; label: string }>> = {
  ASSIGNED:        { to: 'IN_PROGRESS',     label: 'Start task' },
  ACCEPTED:        { to: 'IN_PROGRESS',     label: 'Start task' },
  IN_PROGRESS:     { to: 'AWAITING_REVIEW', label: 'Submit for review' },
  OVERDUE:         { to: 'IN_PROGRESS',     label: 'Start task' },
  AWAITING_REVIEW: undefined,
  COMPLETED:       undefined,
  BLOCKED:         { to: 'IN_PROGRESS',     label: 'Resume task' },
};

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useTask(id);
  const update = useUpdateTaskStatus();

  if (task.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Task" />
        <StateView kind="loading" message="Loading task…" />
      </SafeAreaView>
    );
  }
  if (task.isError || !task.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Task" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => task.refetch()} />
      </SafeAreaView>
    );
  }

  const t = task.data;
  const liveStatus = (update.isSuccess && update.variables ? update.variables.status : t.status) as TaskStatus;
  const status = TASK_STATUS_STYLE[liveStatus];
  const priority = TASK_PRIORITY_STYLE[t.priority];
  const next = NEXT_STATUS[liveStatus];
  const doneCount = t.checklist.filter((c) => c.done).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Task" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{t.title}</Text>
        <View style={styles.badgeRow}>
          <View style={[styles.pill, { backgroundColor: status.bg }]}>
            <View style={[styles.dot, { backgroundColor: status.color }]} />
            <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: priority.bg }]}>
            <Text style={[styles.pillText, { color: priority.color }]}>{priority.label} priority</Text>
          </View>
        </View>

        <View style={[styles.metaCard, shadow1]}>
          {t.dueDate ? (
            <View style={styles.metaRow}>
              <CalendarClock size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.metaText}>{dueLabel(t.dueDate)}</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <User size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.metaText}>Assigned to {t.assigneeName}</Text>
          </View>
          {t.committee ? (
            <View style={styles.metaRow}>
              <Users size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.metaText}>{t.committee} committee</Text>
            </View>
          ) : null}
          {t.meetingTitle ? (
            <View style={styles.metaRow}>
              <ScrollText size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <Text style={styles.metaText}>From: {t.meetingTitle}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Description</Text>
        <Text style={styles.body}>{t.description}</Text>

        {/* Checklist */}
        {t.checklist.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Checklist ({doneCount}/{t.checklist.length})</Text>
            <View style={[styles.metaCard, shadow1]}>
              {t.checklist.map((c) => (
                <View key={c.id} style={styles.checkRow}>
                  {c.done ? <CheckSquare size={18} color={Colors.teal} strokeWidth={2} /> : <Square size={18} color={Colors.outline} strokeWidth={2} />}
                  <Text style={[styles.checkText, c.done && styles.checkTextDone]}>{c.label}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* Comments */}
        {t.comments.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Comments</Text>
            <View style={styles.gap8}>
              {t.comments.map((cm) => (
                <View key={cm.id} style={[styles.commentCard, shadow1]}>
                  <View style={styles.commentHead}>
                    <MessageSquare size={13} color={Colors.primary} strokeWidth={2} />
                    <Text style={styles.commentAuthor}>{cm.author}</Text>
                    <Text style={styles.commentTime}>{relativeTime(cm.createdAt)}</Text>
                  </View>
                  <Text style={styles.commentBody}>{cm.body}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      {next ? (
        <View style={styles.footer}>
          <PrimaryButton
            label={next.label}
            loading={update.isPending}
            onPress={() => update.mutate({ id: t.id, status: next.to })}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  badgeRow: { flexDirection: 'row', gap: Spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  pillText: { ...Typography.caption, fontWeight: '600' as const },
  metaCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metaText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  checkTextDone: { color: Colors.onSurfaceVariant, textDecorationLine: 'line-through' },
  gap8: { gap: Spacing.sm },
  commentCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 4 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  commentAuthor: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  commentTime: { ...Typography.caption, color: Colors.outline },
  commentBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
