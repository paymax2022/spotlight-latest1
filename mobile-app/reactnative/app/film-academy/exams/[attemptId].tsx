// A NATIVE exam attempt: the shuffled, server-drawn questions, tap-to-autosave
// answers, a live countdown to the SERVER deadline, and the committed result.
// THE KEY NEVER ARRIVES. Each option carries an opaque presentationOptionId, not
// a bank id, and nothing here says which option is correct — not while answering,
// and not afterwards. The learner sees only their own last saved pick. (PRD BK-10)
// THE DEADLINE IS THE SERVER'S. The countdown renders from deadlineAt but the
// refusal to accept an answer is enforced server-side at 409; this screen reflects
// that rather than trusting the phone's clock. A reload resumes the same attempt
// with saved answers replayed, because getAttempt reads the immutable snapshot.
// RESULT IS A DIFFERENT VIEW OF THE SAME ROUTE. Once the attempt is scored (or
// expired without a submit), getAttempt returns the result / an empty question
// set, and this screen renders the receipt instead of a live paper.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Award, CircleCheck, Clock, XCircle, Timer,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import {
  getAttempt,
  saveAttemptAnswer,
  submitExamAttempt,
  filmAcademyAttemptKey,
  FILM_ACADEMY_EXAMS_KEY,
} from '@/features/filmAcademy/api';
import { getErrorMessage } from '@/utils/errorMapper';
import type {
  FilmAcademyExamResult,
  FilmAcademyAttemptView,
} from '@/features/filmAcademy/types';

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Ticking mm:ss (hh:mm:ss past an hour) countdown to the server deadline. */
function useCountdown(deadlineAt: string | null): { text: string; remainingMs: number } {
  const target = deadlineAt ? new Date(deadlineAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return { text: '—', remainingMs: 0 };
  const remainingMs = Math.max(0, target - now);
  const total = Math.floor(remainingMs / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return { text, remainingMs };
}

function ResultView({ result }: { result: FilmAcademyExamResult }) {
  const bg = result.passed ? Colors.iconBgGreen : Colors.errorContainer;
  const fg = result.passed ? Colors.teal : Colors.error;
  return (
    <View style={styles.resultWrap}>
      <View style={[styles.resultBadge, { backgroundColor: bg }]}>
        {result.passed
          ? <Award size={30} color={fg} />
          : <XCircle size={30} color={fg} />}
        <Text style={[styles.resultVerdict, { color: fg }]}>
          {result.passed ? 'Passed' : 'Not passed'}
        </Text>
      </View>

      <Text style={styles.resultScore}>{result.scorePercent}%</Text>
      <Text style={styles.meta}>
        {result.earnedPoints} of {result.maxPoints} points · {result.answeredCount} of {result.totalCount} answered
      </Text>
      <Text style={styles.stateText}>
        Your result is recorded. A tutor or your academy can tell you what happens next.
      </Text>

      <Pressable onPress={() => router.replace('/film-academy/exams')} style={styles.doneBtn}>
        <Text style={styles.doneBtnText}>Back to exams</Text>
      </Pressable>
    </View>
  );
}

export default function FilmAcademyAttemptScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const queryClient = useQueryClient();
  const [localPicks, setLocalPicks] = useState<Record<string, string>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: filmAcademyAttemptKey(attemptId ?? ''),
    queryFn: () => getAttempt(attemptId!),
    enabled: !!attemptId,
  });

  const answered = data?.answered ?? {};
  const questions = data?.questions ?? [];
  const pickOf = (aqId: string) => localPicks[aqId] ?? answered[aqId];
  const answeredCount = useMemo(
    () => questions.filter((q) => !!pickOf(q.attemptQuestionId)).length,
    [questions, localPicks, answered],
  );

  const { text: timeText } = useCountdown(data?.deadlineAt ?? null);
  const timeUp = data?.state === 'in_progress' && data.expired;

  const save = useMutation({
    mutationFn: saveAttemptAnswer,
    onError: async (e) => {
      // The server refused (expired or finalized). Reload so the screen reflects
      // the real state instead of letting the learner keep tapping.
      await alertAsync({ title: 'Could not save', message: getErrorMessage(e) });
      void refetch();
    },
  });

  const submit = useMutation({
    mutationFn: () => submitExamAttempt(attemptId!),
    onSuccess: (result) => {
      queryClient.setQueryData(filmAcademyAttemptKey(attemptId!), (prev: FilmAcademyAttemptView | undefined) =>
        prev ? { ...prev, state: 'scored', result, questions: [] } : prev);
      void queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_EXAMS_KEY });
    },
    onError: (e) => { void alertAsync({ title: 'Could not submit', message: getErrorMessage(e) }); },
  });

  const tapOption = (attemptQuestionId: string, presentationOptionId: string) => {
    // Past the deadline the paper is frozen — the server refuses late saves, so
    // tapping must not fire a doomed autosave.
    if (data?.expired) return;
    setLocalPicks((m) => ({ ...m, [attemptQuestionId]: presentationOptionId }));
    save.mutate({ attemptId: attemptId!, attemptQuestionId, presentationOptionId });
  };

  const confirmSubmit = async () => {
    // Past the deadline there is nothing to reconsider — record directly.
    if (data?.expired) { submit.mutate(); return; }
    const unanswered = questions.length - answeredCount;
    const ok = await confirmAsync({
      title: 'Submit your exam?',
      message: unanswered > 0
        ? `You still have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Once you submit, the score is final and cannot be changed.`
        : 'All questions are answered. Once you submit, the score is final and cannot be changed.',
      confirmLabel: 'Submit',
      cancelLabel: 'Keep working',
    });
    if (ok) submit.mutate();
  };

  const showResult = !!data && (!!data.result || (data.state !== 'in_progress' && questions.length === 0));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/film-academy/exams')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Exam</Text>
        {data?.state === 'in_progress' && data.deadlineAt ? (
          <View style={[styles.timer, timeUp && styles.timerUp]}>
            <Timer size={14} color={timeUp ? Colors.error : Colors.onSurface} />
            <Text style={[styles.timerText, timeUp && { color: Colors.error }]}>{timeUp ? 'Time up' : timeText}</Text>
          </View>
        ) : <View style={styles.back} />}
      </View>

      {isLoading && (
        <View style={styles.state}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.stateText}>Opening your exam…</Text>
        </View>
      )}

      {!!error && !isLoading && (
        <View style={styles.state}>
          <Text style={styles.stateText}>Could not load this exam.</Text>
          <Pressable onPress={() => refetch()} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {!isLoading && !error && showResult && data?.result && (
        <ScrollView contentContainerStyle={styles.scroll}>
          <ResultView result={data.result} />
        </ScrollView>
      )}

      {!isLoading && !error && data?.state === 'in_progress' && questions.length > 0 && (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            {data.expired && (
              <View style={styles.expiredBanner}>
                <Text style={styles.expiredText}>
                  Time is up — your answers are frozen. Submit to record your result.
                </Text>
              </View>
            )}
            {questions.map((q, idx) => {
              const picked = pickOf(q.attemptQuestionId);
              return (
                <View key={q.attemptQuestionId} style={styles.qCard}>
                  <View style={styles.qHead}>
                    <Text style={styles.qNum}>Question {idx + 1}</Text>
                    <Text style={styles.qPts}>{q.points} pt{q.points === 1 ? '' : 's'}</Text>
                  </View>
                  <Text style={styles.qStem}>{q.stem}</Text>
                  <View style={styles.options}>
                    {q.options.map((o) => {
                      const active = picked === o.presentationOptionId;
                      return (
                        <Pressable
                          key={o.presentationOptionId}
                          onPress={() => tapOption(q.attemptQuestionId, o.presentationOptionId)}
                          disabled={data.expired}
                          style={[styles.option, active && styles.optionActive, data.expired && styles.optionFrozen]}
                        >
                          <View style={[styles.radio, active && styles.radioActive]} />
                          <Text style={[styles.optionText, active && styles.optionTextActive]}>{o.text}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.progressRow}>
              <Clock size={12} color={Colors.onSurfaceVariant} />
              <Text style={styles.meta}>
                {answeredCount} of {questions.length} answered
                {data.expired ? ' · time up' : ''}
              </Text>
            </View>
            <Pressable
              onPress={confirmSubmit}
              disabled={submit.isPending}
              style={[styles.submitBar, submit.isPending && styles.submitDisabled]}
            >
              {submit.isPending
                ? <ActivityIndicator color={Colors.black} />
                : <Text style={styles.submitText}>Submit exam</Text>}
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface, flexShrink: 1, flex: 1, textAlign: 'center' },
  timer:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm,
                 paddingVertical: 4, borderRadius: Radius.sm, backgroundColor: Colors.surfaceVariant },
  timerUp:     { backgroundColor: Colors.errorContainer },
  timerText:   { ...Typography.labelSm, color: Colors.onSurface },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },

  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl,
                 paddingHorizontal: Spacing.containerMargin },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },
  meta:        { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  qCard:       { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  qHead:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qNum:        { ...Typography.titleMd, color: Colors.onSurface },
  qPts:        { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  qStem:       { ...Typography.bodyMd, color: Colors.onSurface },
  options:     { gap: Spacing.xs },
  option:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md,
                 borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceVariant,
                 backgroundColor: Colors.background },
  optionActive:{ borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  optionFrozen:{ opacity: 0.7 },
  expiredBanner: { borderRadius: Radius.md, padding: Spacing.md, backgroundColor: Colors.errorContainer },
  expiredText: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
  radio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: Colors.onSurfaceVariant },
  radioActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  optionText:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  optionTextActive: { color: Colors.onSurface },

  footer:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md,
                 borderTopWidth: 1, borderTopColor: Colors.surfaceVariant, backgroundColor: Colors.surface },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  submitBar:   { flex: 1, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md,
                 alignItems: 'center' },
  submitDisabled: { opacity: 0.6 },
  submitText:  { ...Typography.labelLg, color: Colors.black },

  resultWrap:  { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  resultBadge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg,
                 paddingVertical: Spacing.md, borderRadius: Radius.lg },
  resultVerdict: { ...Typography.titleMd },
  resultScore: { ...Typography.headlineMd, color: Colors.onSurface, fontSize: 40 },
  doneBtn:     { marginTop: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.md,
                 paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, alignItems: 'center' },
  doneBtnText: { ...Typography.labelLg, color: Colors.black },
});
