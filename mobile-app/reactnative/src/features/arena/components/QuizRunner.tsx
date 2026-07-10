// ── QuizRunner — shared one-question-at-a-time runner ────────────────────────
// Powers BOTH the public Play-Along quiz (S2) and the proctored Theory exam (C6)
// against the same Naija Driver bank. Modes differ only in reveal + navigation:
//
//   mode="playalong"  → answer/lock reveals the correct option + explanation
//                       (the teaching moment) before "Next"; forward-only; a
//                       streak counter and instant right/wrong feedback.
//   mode="exam"       → NO correctness shown; answers autosave; free item
//                       navigation (jump to any Q) via a bottom navigator;
//                       a single "Submit" at the end. Answers never revealed and
//                       never leaked in the render.
//
// Timer: a 120s-per-question Countdown (reused visual language of Countdown.tsx,
// re-implemented as a per-question ticking clock). On expiry the item auto-locks
// (unanswered = 0). Big touch targets, tabular-nums timer, accessible options.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Timer, CheckCircle2, Circle, XCircle, Flame, Trophy, ShieldAlert, LayoutGrid,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import type { PlayAlongQuestion } from '../types';
import { PER_QUESTION_SECS, categoryLabel } from '../constants';

export type QuizMode = 'playalong' | 'exam';

export interface QuizRunnerResult {
  /** questionId → selected optionId (only answered questions present). */
  answers: Record<string, string>;
  /** ms from first question shown to submit — tie-breaker (exam responseTimeMs). */
  responseTimeMs: number;
  /** Client-side correct count (playalong only; 0 in exam mode — no leakage). */
  correctCount: number;
}

interface Props {
  mode: QuizMode;
  questions: PlayAlongQuestion[];
  /** Per-question seconds (defaults to the bank's 120s). */
  perQuestionSecs?: number;
  /** Optional resume buffer (exam autosave) — prefills answers + index. */
  initialAnswers?: Record<string, string>;
  initialIndex?: number;
  /** Called on every answer/nav change (exam autosave). */
  onAnswer?: (questionId: string, optionId: string, index: number) => void;
  onIndexChange?: (index: number) => void;
  /** Submit handler — receives the collected answers. Return a promise to show a spinner. */
  onSubmit: (result: QuizRunnerResult) => void;
  submitting?: boolean;
  submitError?: boolean;
  /** Persistent proctored indicator (exam). */
  proctored?: boolean;
}

export default function QuizRunner({
  mode,
  questions,
  perQuestionSecs = PER_QUESTION_SECS,
  initialAnswers,
  initialIndex,
  onAnswer,
  onIndexChange,
  onSubmit,
  submitting,
  submitError,
  proctored,
}: Props) {
  const isExam = mode === 'exam';
  const total = questions.length;

  const [index, setIndex] = useState(initialIndex ?? 0);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers ?? {});
  const [secs, setSecs] = useState(perQuestionSecs);
  const [revealed, setRevealed] = useState(false); // playalong: per-question lock
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const startedAt = useRef<number>(Date.now());

  const current = questions[index];
  const currentAnswer = current ? answers[current.id] : undefined;
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);

  // Whether we can score/reveal locally (playalong mock ships the answer key).
  const canReveal = !isExam && !!current?.correctOptionId;

  // ── Per-question countdown ─────────────────────────────────────────────────
  // Resets on each question. In playalong it stops on reveal; in exam it simply
  // moves to the next item on expiry (unanswered stays unanswered = 0).
  const lockCurrent = useCallback(() => {
    if (isExam) {
      // Exam: auto-advance on expiry (or auto-submit on the last item).
      if (index < total - 1) {
        const ni = index + 1;
        setIndex(ni);
        onIndexChange?.(ni);
      }
      return;
    }
    // Play-along: time up → reveal (breaks streak, 0 points for this item).
    setStreak(0);
    setRevealed(true);
  }, [isExam, index, total, onIndexChange]);

  useEffect(() => {
    if (!current) return;
    if (!isExam && revealed) return; // paused on reveal
    setSecs(current.timeLimitSecs ?? perQuestionSecs);
    const id = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          clearInterval(id);
          lockCurrent();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current?.id, revealed, isExam]);

  // ── Answer ─────────────────────────────────────────────────────────────────
  const pick = (optionId: string) => {
    if (!current) return;
    if (!isExam && revealed) return; // locked after reveal in playalong
    const next = { ...answers, [current.id]: optionId };
    setAnswers(next);
    onAnswer?.(current.id, optionId, index);

    if (canReveal) {
      const correct = optionId === current.correctOptionId;
      if (correct) {
        setStreak((st) => {
          const nx = st + 1;
          setBestStreak((b) => Math.max(b, nx));
          return nx;
        });
      } else {
        setStreak(0);
      }
      setRevealed(true);
    }
  };

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goTo = (i: number) => {
    if (i < 0 || i >= total) return;
    setRevealed(false);
    setIndex(i);
    onIndexChange?.(i);
    setNavOpen(false);
  };

  const advance = () => {
    if (index < total - 1) goTo(index + 1);
    else doSubmit();
  };

  const correctCountFor = useCallback(() => {
    if (isExam) return 0; // never compute/expose correctness in exam mode
    return questions.reduce(
      (n, q) => (q.correctOptionId && answers[q.id] === q.correctOptionId ? n + 1 : n),
      0,
    );
  }, [isExam, questions, answers]);

  const doSubmit = () => {
    onSubmit({
      answers,
      responseTimeMs: Date.now() - startedAt.current,
      correctCount: correctCountFor(),
    });
  };

  if (!current) return null;

  const lowTime = secs <= 10;
  const catLabel = categoryLabel(current.category);
  const onLastItem = index === total - 1;
  // Play-along gate: must reveal before advancing (when reveal is available).
  const advanceDisabled = submitting || (canReveal && !revealed);

  return (
    <View style={styles.wrap}>
      {/* Status bar: mode chip + timer (+ streak/score in playalong) */}
      <View style={styles.statusBar}>
        {isExam ? (
          proctored ? (
            <View style={styles.proctorChip}>
              <ShieldAlert size={12} color={Colors.onWarning} />
              <Text style={styles.proctorText}>Proctored</Text>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )
        ) : (
          <View style={styles.gameStats}>
            <View style={styles.gameStat}>
              <Trophy size={14} color={Colors.gold} />
              <Text style={styles.gameStatText}>{correctCountFor()}</Text>
            </View>
            <View style={styles.gameStat}>
              <Flame size={14} color={streak > 0 ? '#F97316' : Colors.outline} />
              <Text style={[styles.gameStatText, streak > 0 && { color: '#F97316' }]}>{streak}x</Text>
            </View>
          </View>
        )}
        <View style={[styles.timer, lowTime && styles.timerLow]}>
          <Timer size={16} color={lowTime ? Colors.error : Colors.secondary} strokeWidth={2} />
          <Text
            style={[styles.timerText, lowTime && { color: Colors.error }]}
            accessibilityLabel={`${secs} seconds remaining`}
          >
            {formatClock(secs)}
          </Text>
        </View>
      </View>

      {/* Progress */}
      <View style={styles.metaRow}>
        <Text style={styles.qCount}>
          Q {index + 1} of {total}
          {isExam ? ` · ${answeredCount} answered` : ''}
        </Text>
        {catLabel ? <Text style={styles.catChip}>{catLabel}</Text> : null}
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((index + 1) / total) * 100}%` }]} />
      </View>

      {/* Question */}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.prompt} accessibilityRole="header">{current.prompt}</Text>

        {current.options.map((o) => {
          const selected = currentAnswer === o.id;
          const isCorrect = !isExam && revealed && o.id === current.correctOptionId;
          const isWrongPick = !isExam && revealed && selected && o.id !== current.correctOptionId;
          return (
            <Pressable
              key={o.id}
              onPress={() => pick(o.id)}
              disabled={!isExam && revealed}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={o.label}
              style={[
                styles.option,
                selected && styles.optionSel,
                isCorrect && styles.optionCorrect,
                isWrongPick && styles.optionWrong,
              ]}
            >
              {isCorrect ? (
                <CheckCircle2 size={22} color="#16A34A" />
              ) : isWrongPick ? (
                <XCircle size={22} color={Colors.error} />
              ) : selected ? (
                <CheckCircle2 size={22} color={Colors.primary} />
              ) : (
                <Circle size={22} color={Colors.outline} />
              )}
              <Text style={[styles.optionText, selected && styles.optionTextSel]}>{o.label}</Text>
            </Pressable>
          );
        })}

        {/* Play-along reveal (teaching moment) — never rendered in exam mode */}
        {!isExam && revealed ? (
          <View style={[styles.feedback, currentAnswer === current.correctOptionId ? styles.feedbackGood : styles.feedbackBad]}>
            <Text style={styles.feedbackTitle}>
              {currentAnswer === current.correctOptionId
                ? `Correct!${streak > 1 ? `  ${streak}x streak 🔥` : ''}`
                : currentAnswer
                  ? 'Not quite'
                  : 'Time up'}
            </Text>
            {current.explanation ? <Text style={styles.feedbackText}>{current.explanation}</Text> : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Exam item navigator (jump to any question) */}
      {isExam && navOpen ? (
        <View style={styles.navPanel}>
          <Text style={styles.navTitle}>Jump to a question</Text>
          <View style={styles.navGrid}>
            {questions.map((q, i) => {
              const done = !!answers[q.id];
              const here = i === index;
              return (
                <Pressable
                  key={q.id}
                  onPress={() => goTo(i)}
                  accessibilityLabel={`Question ${i + 1}${done ? ', answered' : ', not answered'}`}
                  style={[styles.navCell, done && styles.navCellDone, here && styles.navCellHere]}
                >
                  <Text style={[styles.navCellText, (done || here) && styles.navCellTextOn]}>{i + 1}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Footer controls */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {isExam ? (
          <View style={styles.examControls}>
            <Pressable
              onPress={() => setNavOpen((v) => !v)}
              style={styles.navToggle}
              accessibilityRole="button"
              accessibilityLabel="Toggle question navigator"
            >
              <LayoutGrid size={18} color={Colors.primary} />
              <Text style={styles.navToggleText}>{answeredCount}/{total}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              {onLastItem ? (
                <PrimaryButton
                  label={submitting ? 'Submitting…' : 'Submit exam'}
                  onPress={doSubmit}
                  loading={submitting}
                  disabled={submitting}
                />
              ) : (
                <PrimaryButton label="Next" onPress={() => goTo(index + 1)} disabled={submitting} />
              )}
            </View>
          </View>
        ) : (
          <PrimaryButton
            label={onLastItem ? (submitting ? 'Scoring…' : 'Finish') : 'Next'}
            onPress={advance}
            loading={submitting}
            disabled={advanceDisabled}
          />
        )}
        {isExam && !onLastItem ? (
          <Pressable onPress={doSubmit} disabled={submitting} style={styles.submitEarly}>
            <Text style={styles.submitEarlyText}>Submit now</Text>
          </Pressable>
        ) : null}
        {submitError ? (
          <Text style={styles.error}>Submit failed — your answers are saved. Tap Submit to retry.</Text>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

/** mm:ss for values ≥ 60s, otherwise "12s" (matches the 120s bank cadence). */
function formatClock(secs: number): string {
  if (secs >= 60) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return `${secs}s`;
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm,
  },
  gameStats: { flexDirection: 'row', gap: Spacing.sm },
  gameStat: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  gameStatText: { ...Typography.labelMd, color: Colors.onSurface, fontVariant: ['tabular-nums'] },
  proctorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.iconBgGold, paddingHorizontal: Spacing.sm, paddingVertical: 5,
    borderRadius: Radius.full,
  },
  proctorText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' as const },
  timer: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  timerLow: { backgroundColor: Colors.errorContainer },
  timerText: { ...Typography.titleMd, color: Colors.secondary, fontVariant: ['tabular-nums'] },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md,
  },
  qCount: { ...Typography.labelMd, color: Colors.onSurface },
  catChip: {
    ...Typography.caption, color: Colors.onSurfaceVariant,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 3, overflow: 'hidden',
  },
  progressTrack: {
    height: 4, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm,
  },
  progressFill: { height: 4, backgroundColor: Colors.primary, borderRadius: Radius.full },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm },
  prompt: { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 60,
    borderWidth: 1.5, borderColor: Colors.outlineVariant, borderRadius: Radius.lg,
    padding: Spacing.md, backgroundColor: Colors.surfaceContainerLowest,
  },
  optionSel: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  optionCorrect: { borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.10)' },
  optionWrong: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  optionTextSel: { color: Colors.primary, fontWeight: '600' as const },
  feedback: { borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.xs },
  feedbackGood: { backgroundColor: 'rgba(22,163,74,0.10)' },
  feedbackBad: { backgroundColor: Colors.errorContainer },
  feedbackTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: 2 },
  feedbackText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  navPanel: {
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow, gap: Spacing.sm,
  },
  navTitle: { ...Typography.labelMd, color: Colors.onSurface },
  navGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  navCell: {
    width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  navCellDone: { backgroundColor: Colors.primaryFixed, borderColor: Colors.primary },
  navCellHere: { borderColor: Colors.secondary, borderWidth: 2 },
  navCellText: { ...Typography.labelMd, color: Colors.onSurfaceVariant, fontVariant: ['tabular-nums'] },
  navCellTextOn: { color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },
  examControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  navToggle: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, height: 56,
    paddingHorizontal: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5,
    borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  navToggleText: { ...Typography.labelMd, color: Colors.primary, fontVariant: ['tabular-nums'] },
  submitEarly: { alignItems: 'center', paddingVertical: Spacing.xs },
  submitEarlyText: { ...Typography.labelSm, color: Colors.secondary },
  error: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
});
