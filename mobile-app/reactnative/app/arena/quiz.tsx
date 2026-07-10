import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Gamepad2, ChevronRight, ShieldCheck, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import QuizRunner, { QuizRunnerResult } from '@/features/arena/components/QuizRunner';
import { usePlayAlongStage, useSubmitPlayAlong } from '@/features/arena/hooks';
import { PLAYALONG_STAGES, PER_QUESTION_SECS, NDC1_MERIT_NOTE, stageMeta } from '@/features/arena/constants';
import { newIdempotencyKey } from '@/features/arena/api';
import { useConnectivity } from '@/features/academy/offlineQueue';
import type { PlayAlongPerQuestion } from '@/features/arena/types';

/**
 * S2 — "Are You a Naija Driver?" Play-Along quiz. Three stages (Foundation /
 * Intermediate / Advanced) drawn from the shared safe-driving bank; 120s per
 * question. Stage picker → QuizRunner (playalong mode, with the teaching-moment
 * reveal) → results (S3). ENGAGEMENT only — an attempt never affects Merit
 * (NDC-1). Offline-tolerant: an offline finish queues the attempt.
 */
export default function QuizScreen() {
  const { competitionId: raw, stage: stageParam } = useLocalSearchParams<{ competitionId?: string; stage?: string }>();
  const competitionId = raw ?? '';

  const [stage, setStage] = useState<number>(stageParam ? Number(stageParam) : 1);
  const [started, setStarted] = useState(false);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());

  const { offline } = useConnectivity();
  const q = usePlayAlongStage(competitionId, stage, started);
  const submit = useSubmitPlayAlong();

  const stageSet = q.data;
  const questions = stageSet?.questions ?? [];
  const meta = useMemo(() => stageMeta(stage), [stage]);

  const startStage = () => {
    setIdemKey(newIdempotencyKey());
    setStarted(true);
  };

  const finish = (result: QuizRunnerResult) => {
    const answers = Object.entries(result.answers).map(([questionId, optionId]) => ({ questionId, optionId }));
    submit.mutate(
      { competitionId, stage, answers, idempotencyKey: idemKey },
      {
        onSuccess: (res) => goResults(res),
        // Best-effort: even if the engagement write fails/queues offline, the
        // learner still sees their teaching-moment recap (scored client-side in
        // mock; on a real backend a failed submit shows a retry on results).
        onError: () =>
          goResults({
            score: result.correctCount,
            total: questions.length,
            passed: false,
            perQuestion: [],
            credentialIssued: false,
            credentialHash: null,
            cashbackKobo: null,
          }),
      },
    );
  };

  const goResults = (res: {
    score: number; total: number; passed: boolean;
    perQuestion: PlayAlongPerQuestion[];
    credentialIssued?: boolean; credentialHash?: string | null; cashbackKobo?: number | null;
  }) => {
    router.replace({
      pathname: '/arena/quiz-results',
      params: {
        competitionId,
        stage: String(stage),
        score: String(res.score),
        total: String(res.total),
        passed: res.passed ? '1' : '0',
        hash: res.credentialHash ?? '',
        cashback: res.cashbackKobo != null ? String(res.cashbackKobo) : '',
        perQuestion: encodeURIComponent(JSON.stringify(res.perQuestion ?? [])),
        offline: offline ? '1' : '0',
      },
    });
  };

  // ── Stage picker (intro) ────────────────────────────────────────────────────
  if (!started) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Are You a Naija Driver?" />
        <ScrollView contentContainerStyle={styles.introContent} showsVerticalScrollIndicator={false}>
          <View style={styles.introIcon}><Gamepad2 size={30} color={Colors.primary} /></View>
          <Text style={styles.introTitle}>Play-Along · 3 stages</Text>
          <Text style={styles.introBody}>
            The same safe-driving questions our contestants take. 30 questions a stage, {PER_QUESTION_SECS / 60} minutes
            per question. Keep your streak alive, pass the mark, and earn your Certified Safe Driver badge.
          </Text>

          <Text style={styles.pickLabel}>Choose a stage</Text>
          {PLAYALONG_STAGES.map((s) => {
            const active = s.stage === stage;
            return (
              <Pressable
                key={s.stage}
                onPress={() => setStage(s.stage)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[styles.stageCard, shadow1, active && styles.stageCardActive]}
              >
                <View style={[styles.stageBadge, active && styles.stageBadgeActive]}>
                  <Text style={[styles.stageBadgeText, active && styles.stageBadgeTextActive]}>{s.stage}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stageName}>{s.short}</Text>
                  <Text style={styles.stageBlurb} numberOfLines={2}>{s.blurb}</Text>
                  <Text style={styles.stagePass}>Pass mark {s.passMarkPercent}%</Text>
                </View>
                <ChevronRight size={18} color={active ? Colors.primary : Colors.outline} />
              </Pressable>
            );
          })}

          <View style={styles.metaChips}>
            <View style={styles.metaChip}><Clock size={13} color={Colors.secondary} /><Text style={styles.metaChipText}>{PER_QUESTION_SECS / 60} min / question</Text></View>
            <View style={styles.metaChip}><ShieldCheck size={13} color={Colors.teal} /><Text style={styles.metaChipText}>Badge on {meta.passMarkPercent}%</Text></View>
          </View>

          <View style={styles.note}><Text style={styles.noteText}>{NDC1_MERIT_NOTE}</Text></View>
          <View style={{ height: Spacing.md }} />
          <PrimaryButton label={`Start ${meta.short}`} onPress={startStage} />
          {offline ? <Text style={styles.offlineHint}>You’re offline — you can still play; your attempt will sync when you reconnect.</Text> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Loading / error / empty ─────────────────────────────────────────────────
  if (q.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={meta.short} onBack={() => setStarted(false)} />
        <StateView kind="loading" message="Loading questions…" />
      </SafeAreaView>
    );
  }
  if (q.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={meta.short} onBack={() => setStarted(false)} />
        <StateView kind="error" title="Couldn’t load the quiz" message="Check your connection and try again." actionLabel="Retry" onAction={() => q.refetch()} />
      </SafeAreaView>
    );
  }
  if (questions.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={meta.short} onBack={() => setStarted(false)} />
        <StateView kind="empty" title="No questions yet" message="This stage has no questions available right now." actionLabel="Back" onAction={() => setStarted(false)} />
      </SafeAreaView>
    );
  }

  // ── Runner ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Stage ${stage} · ${stageSet?.stageName ?? ''}`} showBack={false} />
      <QuizRunner
        mode="playalong"
        questions={questions}
        perQuestionSecs={stageSet?.timeLimitSecs ?? PER_QUESTION_SECS}
        onSubmit={finish}
        submitting={submit.isPending}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  introContent: { padding: Spacing.containerMargin, gap: Spacing.sm },
  introIcon: { width: 60, height: 60, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  introTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  introBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  pickLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  stageCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh,
  },
  stageCardActive: { borderColor: Colors.primary },
  stageBadge: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  stageBadgeActive: { backgroundColor: Colors.primary },
  stageBadgeText: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  stageBadgeTextActive: { color: Colors.onPrimary },
  stageName: { ...Typography.labelLg, color: Colors.onSurface },
  stageBlurb: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  stagePass: { ...Typography.caption, color: Colors.secondary, marginTop: 4 },
  metaChips: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  metaChipText: { ...Typography.labelSm, color: Colors.onSurface },
  note: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  offlineHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
});
