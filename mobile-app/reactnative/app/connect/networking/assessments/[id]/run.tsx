import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Clock, ListChecks } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
// REUSE the existing arena quiz engine (Naija Driver runner) — timed,
// one-question-at-a-time, contestant-safe (no answer leak). We do NOT rebuild it.
import QuizRunner, { QuizRunnerResult } from '@/features/arena/components/QuizRunner';
import { useStartAssessmentAttempt, useSubmitAssessmentAttempt } from '@/features/connect/networking/assessments/hooks';
import { newIdempotencyKey } from '@/features/connect/networking/assessments/api';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import type { AssessmentAttempt } from '@/features/connect/networking/assessments/types';

/**
 * SA-02 — Assessment runner. Reuses the arena `QuizRunner` in `exam` mode: timed,
 * one-question-at-a-time, answers autosaved, correctness NEVER revealed (grading
 * is server-side). Start (POST attempts) carries an Idempotency-Key; submit
 * (PATCH …/submit) carries its own. On result we branch to SA-03 (pass/fail) or
 * SA-04 (cooldown) depending on the outcome.
 */
export default function AssessmentRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const assessmentId = String(id ?? '');

  const [started, setStarted] = useState(false);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const startIdem = useRef(newIdempotencyKey());
  const submitIdem = useRef(newIdempotencyKey());
  const startedOnce = useRef(false); // guard against a double POST /attempts

  const start = useStartAssessmentAttempt();
  const submit = useSubmitAssessmentAttempt();

  // Kick off the attempt once the user confirms (fresh idempotency key per start).
  useEffect(() => {
    if (!started || startedOnce.current) return;
    startedOnce.current = true;
    start.mutate(
      { assessmentId, idempotencyKey: startIdem.current },
      { onSuccess: (a) => setAttempt(a) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  function begin() {
    startIdem.current = newIdempotencyKey();
    submitIdem.current = newIdempotencyKey();
    startedOnce.current = false;
    setStarted(true);
  }

  function finish(result: QuizRunnerResult) {
    if (!attempt) return;
    submit.mutate(
      { assessmentId, attemptId: attempt.attemptId, answers: result.answers, idempotencyKey: submitIdem.current },
      {
        onSuccess: (res) => {
          if (res.passed) {
            router.replace({
              pathname: '/connect/networking/assessments/[id]/result',
              params: {
                id: assessmentId,
                passed: '1',
                score: String(res.score),
                threshold: String(res.passThreshold),
                version: res.assessmentVersion,
                badgeSkill: res.badge?.skill ?? '',
                badgeTitle: res.badge?.title ?? '',
                badgeDomain: res.badge?.domain ?? '',
              },
            });
          } else {
            router.replace({
              pathname: '/connect/networking/assessments/[id]/result',
              params: {
                id: assessmentId,
                passed: '0',
                score: String(res.score),
                threshold: String(res.passThreshold),
                version: res.assessmentVersion,
                cooldownUntil: res.cooldownUntil ?? '',
              },
            });
          }
        },
      },
    );
  }

  // ── Intro / confirm ─────────────────────────────────────────────────────────
  if (!started) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Skill assessment" />
        <ScrollView contentContainerStyle={styles.introContent} showsVerticalScrollIndicator={false}>
          <View style={styles.introIcon}><ShieldCheck size={28} color={ConnectColors.brand} /></View>
          <Text style={styles.introTitle}>Before you start</Text>
          <Text style={styles.introBody}>
            This is a timed, one-question-at-a-time assessment. You can't go back once you submit, and
            answers aren't revealed — we grade server-side. Pass the mark to earn a verified skill badge.
          </Text>
          <View style={styles.ruleRow}><Clock size={16} color={Colors.secondary} /><Text style={styles.ruleText}>Each question is timed</Text></View>
          <View style={styles.ruleRow}><ListChecks size={16} color={Colors.secondary} /><Text style={styles.ruleText}>Answer every question — unanswered scores zero</Text></View>
          <View style={styles.ruleRow}><ShieldCheck size={16} color={Colors.secondary} /><Text style={styles.ruleText}>A fail starts a cooldown before you can retry</Text></View>
          <View style={{ height: Spacing.lg }} />
          <PrimaryButton label="Start assessment" onPress={begin} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Loading the attempt ─────────────────────────────────────────────────────
  if (start.isPending || (!attempt && !start.isError)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Skill assessment" />
        <StateView kind="loading" message="Preparing your questions…" />
      </SafeAreaView>
    );
  }
  if (start.isError || !attempt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Skill assessment" />
        <StateView
          kind="error"
          title="Couldn't start"
          message="We couldn't start your attempt. Please try again."
          actionLabel="Retry"
          onAction={() => {
            setAttempt(null);
            start.reset();
            startIdem.current = newIdempotencyKey();
            startedOnce.current = false;
            setStarted(false);
            setTimeout(() => setStarted(true), 0);
          }}
        />
      </SafeAreaView>
    );
  }

  // ── Runner (reused arena engine, exam mode) ─────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Assessment" subtitle={`Pass mark ${attempt.passThreshold}% · ${attempt.assessmentVersion}`} showBack={false} />
      <QuizRunner
        mode="exam"
        proctored
        questions={attempt.questions}
        perQuestionSecs={attempt.perQuestionSecs}
        onSubmit={finish}
        submitting={submit.isPending}
        submitError={submit.isError}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  introContent: { padding: Spacing.containerMargin, gap: Spacing.sm },
  introIcon: {
    width: 60, height: 60, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  introTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  introBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ruleText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
