// One module on My course: a collapsible card with a state chip, the lessons, and the
// module quiz block. A locked module is a single non-expandable row that says how to
// unlock it — never a faded card with an overlay.

import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import {
  ChevronDown, ChevronUp, ChevronRight, CircleCheck, Circle, Clock, Lock, ClipboardCheck, CheckCircle2, AlertCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import type { FilmAcademyModule } from '../types';
import { moduleState, quizAction, type ModuleState } from '../journey';

const CHIP: Record<ModuleState, { label: string; bg: string; fg: string }> = {
  locked:      { label: 'Locked',      bg: Colors.surfaceVariant,  fg: Colors.onSurfaceVariant },
  not_started: { label: 'Not started', bg: Colors.surfaceVariant,  fg: Colors.onSurfaceVariant },
  in_progress: { label: 'In progress', bg: Colors.primaryFixed,    fg: Colors.onPrimaryFixed },
  quiz_ready:  { label: 'Quiz ready',  bg: Colors.iconBgGold,      fg: Colors.onWarning },
  passed:      { label: 'Passed',      bg: Colors.iconBgTeal,      fg: Colors.teal },
  complete:    { label: 'Complete',    bg: Colors.iconBgTeal,      fg: Colors.teal },
};

type Props = {
  module: FilmAcademyModule;
  /** 1-based, shown as "Module N". */
  number: number;
  expanded: boolean;
  onToggle: () => void;
  /** Shown on a locked module, e.g. "Pass the Module 1 quiz (85%) to unlock". */
  unlockHint: string;
  onStartQuiz: (quizId: string) => void;
  startingQuizId: string | null;
  quizError: string | null;
};

function QuizBlock({ module, onStartQuiz, startingQuizId, quizError }: Pick<Props, 'module' | 'onStartQuiz' | 'startingQuizId' | 'quizError'>) {
  const quiz = module.quiz;
  const action = quizAction(module);
  if (!quiz || !action) return null;
  const starting = startingQuizId === quiz.id;

  return (
    <View style={styles.quiz}>
      <View style={styles.quizHead}>
        <ClipboardCheck size={18} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.quizTitle}>{quiz.title}</Text>
          <Text style={styles.quizMeta}>
            Pass mark {quiz.passMark}% · {quiz.timeLimitMinutes} min · up to {quiz.maxAttempts} attempts
          </Text>
        </View>
      </View>

      {action.kind === 'finish_lessons' && (
        <View style={[styles.notice, { backgroundColor: Colors.surfaceVariant }]}>
          <AlertCircle size={16} color={Colors.onSurfaceVariant} />
          <Text style={styles.noticeText}>
            Finish {action.remaining} more lesson{action.remaining === 1 ? '' : 's'} to unlock this quiz.
          </Text>
        </View>
      )}

      {action.kind === 'unavailable' && (
        <View style={[styles.notice, { backgroundColor: Colors.surfaceVariant }]}>
          <AlertCircle size={16} color={Colors.onSurfaceVariant} />
          <Text style={styles.noticeText}>This quiz is not available yet.</Text>
        </View>
      )}

      {action.kind === 'passed' && (
        <View style={[styles.notice, { backgroundColor: Colors.iconBgTeal }]}>
          <CheckCircle2 size={18} color={Colors.teal} />
          <Text style={styles.noticeStrong}>Passed · {action.scorePercent}%</Text>
        </View>
      )}

      {action.kind === 'retry' && (
        <View style={[styles.notice, { backgroundColor: Colors.errorContainer }]}>
          <AlertCircle size={18} color={Colors.error} />
          <Text style={[styles.noticeStrong, { flex: 1 }]}>Not passed · {action.scorePercent}%</Text>
        </View>
      )}

      {(action.kind === 'start' || action.kind === 'retry') && (
        <Pressable
          onPress={() => onStartQuiz(quiz.id)}
          disabled={starting}
          style={({ pressed }) => [styles.quizBtn, pressed && { opacity: 0.92 }, starting && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={action.kind === 'retry' ? 'Retry module quiz' : 'Take module quiz'}
        >
          {starting
            ? <ActivityIndicator color={Colors.onPrimary} />
            : <Text style={styles.quizBtnText}>{action.kind === 'retry' ? 'Retry quiz' : 'Take quiz'}</Text>}
        </Pressable>
      )}

      {!!quizError && <Text style={styles.errorText}>{quizError}</Text>}
    </View>
  );
}

export default function ModuleCard(props: Props) {
  const { module: m, number, expanded, onToggle, unlockHint } = props;
  const state = moduleState(m);

  if (state === 'locked') {
    return (
      <View style={[styles.card, styles.lockedRow]} accessibilityLabel={`Module ${number}, ${m.title}, locked. ${unlockHint}`}>
        <Lock size={20} color={Colors.onSurfaceVariant} />
        <View style={{ flex: 1 }}>
          <Text style={styles.lockedTitle}>Module {number} · {m.title}</Text>
          <Text style={styles.lockedHint}>{unlockHint}</Text>
        </View>
      </View>
    );
  }

  const chip = CHIP[state];
  const total = m.lessons.length;
  const pct = total > 0 ? Math.round((m.completedCount / total) * 100) : 0;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onToggle}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Module ${number}, ${m.title}, ${chip.label}, ${m.completedCount} of ${total} lessons complete`}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.eyebrow}>Module {number}</Text>
          <Text style={styles.title}>{m.title}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.chip, { backgroundColor: chip.bg }]}>
              <Text style={[styles.chipText, { color: chip.fg }]}>{chip.label}</Text>
            </View>
            <Text style={styles.meta}>{m.completedCount} of {total} lessons</Text>
          </View>
          <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
        </View>
        {expanded
          ? <ChevronUp size={20} color={Colors.onSurfaceVariant} />
          : <ChevronDown size={20} color={Colors.onSurfaceVariant} />}
      </Pressable>

      {expanded && (
        <View>
          {!!m.description && <Text style={styles.desc}>{m.description}</Text>}
          {m.lessons.map((l) => (
            <Pressable
              key={l.id}
              onPress={() => router.push(`/film-academy/lesson/${l.id}` as never)}
              style={styles.lessonRow}
              accessibilityRole="button"
              accessibilityLabel={`${l.title}${l.completed ? ', completed' : ''}`}
            >
              {l.completed
                ? <CircleCheck size={18} color={Colors.teal} />
                : <Circle size={18} color={Colors.onSurfaceVariant} />}
              <View style={styles.lessonBody}>
                <Text style={[styles.lessonTitle, l.completed && { color: Colors.onSurfaceVariant }]}>{l.title}</Text>
                {!!l.estimated_minutes && (
                  <View style={styles.metaRow}>
                    <Clock size={12} color={Colors.onSurfaceVariant} />
                    <Text style={styles.meta}>{l.estimated_minutes} min</Text>
                  </View>
                )}
              </View>
              <ChevronRight size={16} color={Colors.onSurfaceVariant} />
            </Pressable>
          ))}
          <QuizBlock
            module={m}
            onStartQuiz={props.onStartQuiz}
            startingQuizId={props.startingQuizId}
            quizError={props.quizError}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  head:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  eyebrow:     { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  title:       { ...Typography.titleMd, color: Colors.onSurface },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  meta:        { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chip:        { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  chipText:    { ...Typography.labelSm },
  bar:         { height: 4, borderRadius: 2, backgroundColor: Colors.surfaceVariant, overflow: 'hidden' },
  barFill:     { height: 4, borderRadius: 2, backgroundColor: Colors.primary },
  desc:        { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },

  lessonRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, minHeight: 44,
                 borderTopWidth: 1, borderTopColor: Colors.surfaceVariant },
  lessonBody:  { flex: 1, gap: 2 },
  lessonTitle: { ...Typography.bodyMd, color: Colors.onSurface },

  quiz:        { marginTop: Spacing.sm, paddingTop: Spacing.md, borderTopWidth: 1,
                 borderTopColor: Colors.surfaceVariant, gap: Spacing.sm },
  quizHead:    { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  quizTitle:   { ...Typography.labelLg, color: Colors.onSurface },
  quizMeta:    { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  notice:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.md },
  noticeText:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  noticeStrong: { ...Typography.labelMd, color: Colors.onSurface },
  quizBtn:     { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md,
                 borderRadius: Radius.md, backgroundColor: Colors.primary },
  quizBtnText: { ...Typography.labelLg, color: Colors.onPrimary },
  errorText:   { ...Typography.bodySm, color: Colors.error },

  lockedRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  lockedTitle: { ...Typography.labelLg, color: Colors.onSurface },
  lockedHint:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
