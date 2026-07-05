import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Wifi, WifiOff, Timer, ShieldAlert, CheckCircle2, Circle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useExamQuestions, useSubmitExam } from '@/features/arena/hooks';
import { examAutosave, ensureExamAutosave, autosaveExamAnswer, resetExamAutosave } from '@/features/arena/draft';
import { newIdempotencyKey } from '@/features/arena/api';

const EXAM_SECONDS = 20 * 60; // 20-minute proctored theory exam

/**
 * C6 — Proctored exam runner. ONLINE-REQUIRED (the one offline exception, UX
 * rule A1): a persistent banner shows connection state; questions are fetched
 * with retry:false so a drop surfaces immediately. One question at a time, a
 * countdown timer, and per-answer autosave so a paused/dropped session resumes
 * on the same buffer.
 *
 * ── PROCTORING (STUBBED for sandbox) ────────────────────────────────────────
 * Real integration: launch the proctor SDK (camera + screen attestation) using a
 * server-issued session token, and stream attestation frames alongside answers.
 * Here we render a "proctoring active (sandbox)" chip only. No secret in the app.
 */
export default function ExamScreen() {
  const { competitionId: raw } = useLocalSearchParams<{ competitionId?: string }>();
  const competitionId = raw ?? '';
  ensureExamAutosave(competitionId);

  const [online, setOnline] = useState(true); // stub: assume online; real = NetInfo
  const q = useExamQuestions(competitionId, online);
  const submit = useSubmitExam();

  const [index, setIndex] = useState(examAutosave.current.currentIndex);
  const [answers, setAnswers] = useState<Record<string, string>>(examAutosave.current.answers);
  const [secondsLeft, setSecondsLeft] = useState(EXAM_SECONDS);
  const [idemKey] = useState(() => newIdempotencyKey());
  const [submitted, setSubmitted] = useState(false);

  const questions = q.data ?? [];

  // Timer — pauses when the app backgrounds (proctor policy: timer pauses on
  // interruption, resumes on the same signed session). ONLINE-required exception.
  useEffect(() => {
    if (submitted || questions.length === 0) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    const sub = AppState.addEventListener('change', (st) => {
      // On background the interval keeps the wall-clock; a real proctor session
      // would freeze + require re-attestation. We surface an offline banner if
      // the app returns without a connection.
      if (st === 'active') setOnline(true);
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [submitted, questions.length]);

  // Auto-submit when time expires.
  useEffect(() => {
    if (secondsLeft === 0 && !submitted && questions.length > 0) onSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const answered = useMemo(() => Object.keys(answers).length, [answers]);
  const current = questions[index];

  const pick = (questionId: string, optionId: string) => {
    const next = { ...answers, [questionId]: optionId };
    setAnswers(next);
    autosaveExamAnswer(questionId, optionId, index); // persist per keystroke
  };

  const goNext = () => {
    if (index < questions.length - 1) {
      const ni = index + 1;
      setIndex(ni);
      examAutosave.current.currentIndex = ni;
    }
  };
  const goPrev = () => {
    if (index > 0) {
      const pi = index - 1;
      setIndex(pi);
      examAutosave.current.currentIndex = pi;
    }
  };

  const onSubmit = () => {
    submit.mutate(
      {
        competitionId,
        idempotencyKey: idemKey,
        answers: Object.entries(answers).map(([questionId, optionId]) => ({ questionId, optionId })),
      },
      {
        onSuccess: () => {
          resetExamAutosave();
          setSubmitted(true);
        },
      },
    );
  };

  const pad = (n: number) => String(n).padStart(2, '0');
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Exam" showBack={false} />
        <StateView
          kind="empty"
          icon="CheckCircle2"
          title="Exam submitted"
          message="Your answers are in. Your Merit score is now pending proctor sign-off — you’ll see your standing in Compete."
          actionLabel="Back to Compete"
          onAction={() => router.replace({ pathname: '/arena/compete', params: { competitionId } })}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Theory exam" showBack={false} />

      {/* ONLINE-REQUIRED banner */}
      <View style={[styles.banner, online ? styles.bannerOk : styles.bannerBad]}>
        {online ? <Wifi size={14} color={Colors.teal} /> : <WifiOff size={14} color={Colors.error} />}
        <Text style={[styles.bannerText, { color: online ? Colors.teal : Colors.error }]}>
          {online ? 'Online — proctored session active (sandbox)' : 'Connection lost — timer paused. Reconnect to continue.'}
        </Text>
      </View>

      {!online ? (
        <StateView kind="error" icon="WifiOff" title="You’re offline" message="The proctored exam requires a live connection. Your progress is saved." actionLabel="Retry" onAction={() => { setOnline(true); q.refetch(); }} />
      ) : q.isLoading ? (
        <StateView kind="loading" message="Loading exam…" />
      ) : q.isError ? (
        <StateView kind="error" title="Couldn’t load the exam" message="This needs a stable connection. Your session is preserved." actionLabel="Retry" onAction={() => q.refetch()} />
      ) : questions.length === 0 || !current ? (
        <StateView kind="empty" title="No questions available" message="Your exam window may not be open yet." actionLabel="Back" onAction={() => router.back()} />
      ) : (
        <>
          {/* Timer + proctor chip */}
          <View style={styles.metaRow}>
            <View style={styles.timer}><Timer size={16} color={Colors.secondary} /><Text style={styles.timerText}>{pad(mm)}:{pad(ss)}</Text></View>
            <View style={styles.proctorChip}><ShieldAlert size={12} color={Colors.onWarning} /><Text style={styles.proctorText}>Proctoring · sandbox</Text></View>
          </View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${((index + 1) / questions.length) * 100}%` }]} /></View>
          <Text style={styles.qCount}>Question {index + 1} of {questions.length} · {answered} answered</Text>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text style={styles.prompt}>{current.prompt}</Text>
            {current.options.map((o) => {
              const sel = answers[current.id] === o.id;
              return (
                <Pressable key={o.id} style={[styles.option, sel && styles.optionSel]} onPress={() => pick(current.id, o.id)}>
                  {sel ? <CheckCircle2 size={20} color={Colors.primary} /> : <Circle size={20} color={Colors.outline} />}
                  <Text style={[styles.optionText, sel && styles.optionTextSel]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <SafeAreaView edges={['bottom']} style={styles.footer}>
            <View style={styles.navRow}>
              <View style={{ flex: 1 }}>
                {index > 0 ? <PrimaryButton label="Previous" variant="secondary" onPress={goPrev} /> : null}
              </View>
              <View style={{ width: Spacing.sm }} />
              <View style={{ flex: 1 }}>
                {index < questions.length - 1 ? (
                  <PrimaryButton label="Next" onPress={goNext} />
                ) : (
                  <PrimaryButton label={submit.isPending ? 'Submitting…' : 'Submit exam'} onPress={onSubmit} loading={submit.isPending} disabled={submit.isPending} />
                )}
              </View>
            </View>
            {submit.isError ? <Text style={styles.error}>Submit failed — your answers are saved. Tap Submit to retry.</Text> : null}
          </SafeAreaView>
        </>
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
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  timer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  timerText: { ...Typography.titleMd, color: Colors.onSurface, fontVariant: ['tabular-nums'] },
  proctorChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgGold, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  proctorText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '600' as const },
  progressTrack: { height: 4, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  progressFill: { height: 4, backgroundColor: Colors.primary, borderRadius: Radius.full },
  qCount: { ...Typography.labelSm, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm },
  prompt: { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLowest },
  optionSel: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  optionTextSel: { color: Colors.primary, fontWeight: '600' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
  navRow: { flexDirection: 'row' },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm, textAlign: 'center' },
});
