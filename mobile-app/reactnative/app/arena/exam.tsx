import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Wifi, WifiOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import QuizRunner, { QuizRunnerResult } from '@/features/arena/components/QuizRunner';
import { useExam, useSubmitExam } from '@/features/arena/hooks';
import { examAutosave, ensureExamAutosave, autosaveExamAnswer, resetExamAutosave } from '@/features/arena/draft';
import { newIdempotencyKey, ExamNotAssignedError } from '@/features/arena/api';

/**
 * C6 — Proctored Theory exam runner. Runs the shared QuizRunner in EXAM mode:
 * one question at a time, a 120s-per-question timer, an item navigator (jump to
 * any question, answered/unanswered shown), per-answer autosave (survives a
 * paused/dropped session), and NO correctness reveal. Submit → THEORY_TAKEN.
 *
 * GUARDS
 *  - ONLINE-REQUIRED (UX rule A1): a persistent banner shows connection state;
 *    the feed is fetched with retry:false so a drop surfaces immediately.
 *  - Only reachable when the contestant is THEORY_ASSIGNED. A 409 from the
 *    backend surfaces as ExamNotAssignedError and we show a graceful "not
 *    assigned yet" state instead of a raw error.
 *  - Answers are contestant-safe: only selected optionIds ever leave the device.
 *
 * PROCTORING is stubbed for the sandbox (a "Proctored" chip only). Real
 * integration launches the proctor SDK with a server-issued session token; no
 * secret lives in the app.
 */
export default function ExamScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';
  ensureExamAutosave(competitionId);

  const [online, setOnline] = useState(true); // stub: assume online; real = NetInfo
  const q = useExam(competitionId, online);
  const submit = useSubmitExam();
  const [idemKey] = useState(() => newIdempotencyKey());
  const [submitted, setSubmitted] = useState(false);

  const assignment = q.data;
  const questions = assignment?.questions ?? [];
  const notAssigned = q.error instanceof ExamNotAssignedError;

  // Reconnect detection stub — a real build uses NetInfo. On app foreground we
  // optimistically flip back online and let the query surface any real drop.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setOnline(true);
    });
    return () => sub.remove();
  }, []);

  const onSubmit = (result: QuizRunnerResult) => {
    const answers = Object.entries(result.answers).map(([questionId, optionId]) => ({ questionId, optionId }));
    submit.mutate(
      { competitionId, answers, responseTimeMs: result.responseTimeMs, idempotencyKey: idemKey },
      {
        onSuccess: () => {
          resetExamAutosave();
          setSubmitted(true);
          // C7 — result pending screen reflecting state THEORY_TAKEN.
          router.replace({ pathname: '/arena/exam-result', params: { competitionId } });
        },
      },
    );
  };

  // ── Submitted (handled by redirect; guard against back-nav flash) ───────────
  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Theory exam" showBack={false} />
        <StateView kind="loading" message="Submitting…" />
      </SafeAreaView>
    );
  }

  // ── Guard: not THEORY_ASSIGNED (409) ────────────────────────────────────────
  if (notAssigned) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Theory exam" showBack={false} />
        <StateView
          kind="empty"
          icon="CalendarClock"
          title="Exam not assigned yet"
          message="You’ll be able to sit the proctored exam once your batch is assigned and the window opens. We’ll notify you."
          actionLabel="Back to Compete"
          onAction={() => router.replace({ pathname: '/arena/compete', params: { competitionId } })}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Theory exam"
        subtitle={assignment ? `Batch ${assignment.batch}` : undefined}
        showBack={false}
      />

      {/* ONLINE-REQUIRED banner */}
      <View style={[styles.banner, online ? styles.bannerOk : styles.bannerBad]}>
        {online ? <Wifi size={14} color={Colors.teal} /> : <WifiOff size={14} color={Colors.error} />}
        <Text style={[styles.bannerText, { color: online ? Colors.teal : Colors.error }]}>
          {online ? 'Online — proctored session active (sandbox)' : 'Connection lost — reconnect to continue.'}
        </Text>
      </View>

      {!online ? (
        <StateView
          kind="error" icon="WifiOff" title="You’re offline"
          message="The proctored exam requires a live connection. Your progress is saved."
          actionLabel="Retry" onAction={() => { setOnline(true); q.refetch(); }}
        />
      ) : q.isLoading ? (
        <StateView kind="loading" message="Loading exam…" />
      ) : q.isError ? (
        <StateView
          kind="error" title="Couldn’t load the exam"
          message="This needs a stable connection. Your session is preserved."
          actionLabel="Retry" onAction={() => q.refetch()}
        />
      ) : questions.length === 0 ? (
        <StateView kind="empty" title="No questions available" message="Your exam window may not be open yet." actionLabel="Back" onAction={() => router.back()} />
      ) : (
        <QuizRunner
          mode="exam"
          proctored
          questions={questions}
          perQuestionSecs={assignment?.timeLimitSecs}
          initialAnswers={examAutosave.current.answers}
          initialIndex={examAutosave.current.currentIndex}
          onAnswer={(questionId, optionId, index) => autosaveExamAnswer(questionId, optionId, index)}
          onIndexChange={(index) => { examAutosave.current.currentIndex = index; }}
          onSubmit={onSubmit}
          submitting={submit.isPending}
          submitError={submit.isError}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  bannerOk: { backgroundColor: Colors.iconBgTeal },
  bannerBad: { backgroundColor: Colors.errorContainer },
  bannerText: { ...Typography.labelSm },
});
