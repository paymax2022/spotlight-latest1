// A NATIVE topic quiz attempt: the server-drawn, shuffled questions, tap-to-
// autosave, a live countdown to the SERVER deadline, and the committed receipt.
//
// THE ANSWER KEY NEVER ARRIVES. Options carry opaque presentation ids, and the
// snapshot order is shuffled server-side.
// THE GATE IS EXACT. The server decides pass/fail with integer arithmetic
// (earned * 100 >= possible * 85); the percentage shown here is display-only.
// THE RECEIPT IS AT-MOST-ONCE. A duplicate submit returns the same committed
// result, and the mastery event stream (polled by the path screen) reconciles
// other devices shortly after.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Award, CircleCheck, Clock, XCircle, Timer, Target,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import {
  getTopicAttempt,
  getTopic,
  saveTopicAnswer,
  submitTopicAttempt,
  filmAcademyTopicAttemptKey,
  filmAcademyTopicKey,
  FILM_ACADEMY_PATH_KEY,
} from '@/features/filmAcademy/api';
import { getErrorMessage } from '@/utils/errorMapper';
import type {
  FilmTopicAttemptView,
  FilmTopicQuizReceipt,
  TopicLearnerState,
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
    setNow(Date.now());
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

function masteryMessage(state: TopicLearnerState, passed: boolean): string {
  if (state === 'MASTERED') return 'Mastered — the next topic is unlocked.';
  if (state === 'PASSED') {
    return 'Quiz passed. A practical or review hold must be cleared before the next topic unlocks.';
  }
  if (!passed) {
    return 'Below the 85% mastery gate. Re-read the topic and retake the quiz when you are ready.';
  }
  return 'Your result is recorded.';
}

function ResultView({
  result,
  outcomes,
}: {
  result: FilmTopicQuizReceipt;
  outcomes: Map<string, string>;
}) {
  const passed = result.masteryState === 'MASTERED' || result.masteryState === 'PASSED';
  const bg = passed ? Colors.iconBgGreen : Colors.errorContainer;
  const fg = passed ? Colors.teal : Colors.error;

  return (
    <View style={styles.resultWrap}>
      <View style={[styles.resultBadge, { backgroundColor: bg }]}>
        {passed ? <Award size={30} color={fg} /> : <XCircle size={30} color={fg} />}
        <Text style={[styles.resultVerdict, { color: fg }]}>
          {result.masteryState === 'MASTERED'
            ? 'Mastered'
            : result.masteryState === 'PASSED'
              ? 'Passed — hold open'
              : 'Not passed'}
        </Text>
      </View>

      <Text style={styles.resultScore}>{result.percentage}%</Text>
      <Text style={styles.meta}>
        {result.earnedPoints} of {result.possiblePoints} points · {result.answeredCount} of{' '}
        {result.totalCount} answered · pass mark {result.threshold}%
      </Text>
      <Text style={styles.stateText}>{masteryMessage(result.masteryState, passed)}</Text>

      {result.objectives.length > 0 && (
        <View style={styles.objectivesCard}>
          <View style={styles.objectivesHead}>
            <Target size={16} color={Colors.gold} />
            <Text style={styles.objectivesTitle}>By learning outcome</Text>
          </View>
          {result.objectives.map((objective) => (
            <View key={objective.objectiveId} style={styles.objectiveRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.objectiveId}>{objective.objectiveId}</Text>
                {!!outcomes.get(objective.objectiveId) && (
                  <Text style={styles.objectiveDesc} numberOfLines={2}>
                    {outcomes.get(objective.objectiveId)}
                  </Text>
                )}
              </View>
              <Text style={styles.objectiveScore}>
                {objective.earnedPoints}/{objective.possiblePoints}
              </Text>
            </View>
          ))}
        </View>
      )}

      {result.nextTopic && result.masteryState === 'MASTERED' && result.nextTopic.canStartQuiz && (
        <Pressable
          onPress={() => router.replace(`/film-academy/topic/${result.nextTopic!.topicId}` as never)}
          style={styles.primaryBtn}
        >
          <Text style={styles.primaryBtnText} numberOfLines={1}>
            Next: {result.nextTopic.title}
          </Text>
        </Pressable>
      )}
      <Pressable
        onPress={() => router.replace(`/film-academy/topic/${result.topicId}` as never)}
        style={styles.secondaryBtn}
      >
        <Text style={styles.secondaryBtnText}>Back to topic</Text>
      </Pressable>
    </View>
  );
}

export default function FilmAcademyTopicAttemptScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const queryClient = useQueryClient();
  const [localPicks, setLocalPicks] = useState<Record<string, string>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: filmAcademyTopicAttemptKey(attemptId ?? ''),
    queryFn: () => getTopicAttempt(attemptId!),
    enabled: !!attemptId,
  });

  // Outcome descriptions for the receipt's objective breakdown. Read from the
  // same cached topic the learner came from; a miss only shortens the labels.
  const topicQuery = useQuery({
    queryKey: filmAcademyTopicKey(data?.topicId ?? ''),
    queryFn: () => getTopic(data!.topicId),
    enabled: !!data?.topicId && !!data?.result,
  });
  const outcomes = useMemo(
    () => new Map((topicQuery.data?.outcomes ?? []).map((o) => [o.objective_id, o.description])),
    [topicQuery.data],
  );

  const answered = data?.answered ?? {};
  const questions = data?.questions ?? [];
  const pickOf = (aqId: string) => localPicks[aqId] ?? answered[aqId];
  const answeredCount = useMemo(
    () => questions.filter((q) => !!pickOf(q.attemptQuestionId)).length,
    [questions, localPicks, answered],
  );

  const { text: timeText, remainingMs } = useCountdown(data?.deadlineAt ?? null);
  // Freeze the form the moment the SERVER deadline passes on this device, not
  // only when a fetch happens to report `expired`. The server still enforces
  // the deadline on every save and submit.
  const timeUp = data?.state === 'in_progress' && !!data.deadlineAt
    && (data.expired || remainingMs <= 0);

  const save = useMutation({
    mutationFn: saveTopicAnswer,
    onError: async (e) => {
      // The server refused (expired or finalized). Reload so the screen reflects
      // the real state instead of letting the learner keep tapping.
      await alertAsync({ title: 'Could not save', message: getErrorMessage(e) });
      void refetch();
    },
  });

  const submit = useMutation({
    mutationFn: () => submitTopicAttempt(attemptId!),
    onSuccess: (result) => {
      queryClient.setQueryData(
        filmAcademyTopicAttemptKey(attemptId!),
        (prev: FilmTopicAttemptView | undefined) =>
          prev ? { ...prev, state: 'scored', result, questions: [] } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_PATH_KEY });
      void queryClient.invalidateQueries({ queryKey: filmAcademyTopicKey(result.topicId) });
    },
    onError: (e) => { void alertAsync({ title: 'Could not submit', message: getErrorMessage(e) }); },
  });

  const tapOption = (attemptQuestionId: string, presentationOptionId: string) => {
    if (timeUp) return;
    setLocalPicks((m) => ({ ...m, [attemptQuestionId]: presentationOptionId }));
    save.mutate({ attemptId: attemptId!, attemptQuestionId, presentationOptionId });
  };

  const confirmSubmit = async () => {
    if (timeUp) { submit.mutate(); return; }
    const unanswered = questions.length - answeredCount;
    const ok = await confirmAsync({
      title: 'Submit your quiz?',
      message: unanswered > 0
        ? `You still have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. The score is final once submitted.`
        : 'All questions are answered. The score is final once submitted.',
      confirmLabel: 'Submit',
      cancelLabel: 'Keep working',
    });
    if (ok) submit.mutate();
  };

  const showResult = !!data && (!!data.result || (data.state !== 'in_progress' && questions.length === 0));
  const backToTopic = () => router.replace(
    `/film-academy/topic/${data?.topicId ?? ''}` as never,
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={backToTopic} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Topic quiz</Text>
        {data?.state === 'in_progress' && data.deadlineAt ? (
          <View style={[styles.timer, timeUp && styles.timerUp]}>
            <Timer size={14} color={timeUp ? Colors.error : Colors.onSurface} />
            <Text style={[styles.timerText, timeUp && { color: Colors.error }]}>
              {timeUp ? 'Time up' : timeText}
            </Text>
          </View>
        ) : <View style={styles.back} />}
      </View>

      {isLoading && (
        <View style={styles.state}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.stateText}>Opening your quiz…</Text>
        </View>
      )}

      {!!error && !isLoading && (
        <View style={styles.state}>
          <Text style={styles.stateText}>Could not load this quiz attempt.</Text>
          <Pressable onPress={() => refetch()} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {!isLoading && !error && showResult && data?.result && (
        <ScrollView contentContainerStyle={styles.scroll}>
          <ResultView result={data.result} outcomes={outcomes} />
        </ScrollView>
      )}

      {!isLoading && !error && data?.state === 'in_progress' && questions.length > 0 && (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            {timeUp && (
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
                          disabled={timeUp}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active, disabled: timeUp }}
                          style={[styles.option, active && styles.optionActive, timeUp && styles.optionFrozen]}
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
                {timeUp ? ' · time up' : ''}
              </Text>
            </View>
            <Pressable
              onPress={confirmSubmit}
              disabled={submit.isPending}
              style={[styles.submitBar, submit.isPending && styles.submitDisabled]}
            >
              {submit.isPending
                ? <ActivityIndicator color={Colors.black} />
                : <Text style={styles.submitText}>Submit quiz</Text>}
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
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface, flexShrink: 1, flex: 1,
                 textAlign: 'center' },
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
  submitBar:   { flex: 1, backgroundColor: Colors.gold, borderRadius: Radius.md,
                 paddingVertical: Spacing.md, alignItems: 'center' },
  submitDisabled: { opacity: 0.6 },
  submitText:  { ...Typography.labelLg, color: Colors.black, fontWeight: '700' },

  resultWrap:  { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  resultBadge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg,
                 paddingVertical: Spacing.md, borderRadius: Radius.lg },
  resultVerdict: { ...Typography.titleMd },
  resultScore: { ...Typography.headlineLg, color: Colors.onSurface },
  objectivesCard: { alignSelf: 'stretch', backgroundColor: Colors.surface, borderRadius: Radius.lg,
                    padding: Spacing.lg, gap: Spacing.sm, marginTop: Spacing.md },
  objectivesHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  objectivesTitle:{ ...Typography.labelLg, color: Colors.onSurface },
  objectiveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm,
                  borderTopWidth: 1, borderTopColor: Colors.surfaceVariant },
  objectiveId: { ...Typography.labelMd, color: Colors.gold, fontWeight: '700' },
  objectiveDesc: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  objectiveScore: { ...Typography.labelLg, color: Colors.onSurface },
  primaryBtn:  { alignSelf: 'stretch', backgroundColor: Colors.gold, borderRadius: Radius.md,
                 paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, alignItems: 'center',
                 marginTop: Spacing.md },
  primaryBtnText: { ...Typography.labelLg, color: Colors.black, fontWeight: '700' },
  secondaryBtn: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
  secondaryBtnText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
});
