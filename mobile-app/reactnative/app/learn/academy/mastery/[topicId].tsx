import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Target, Lock, Unlock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import QuestionCard from '@/features/academy/components/QuestionCard';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useObjectives, useSubmitPractice } from '@/features/academy/hooks';
import { getPractice } from '@/features/academy/api';
import type { Question, PracticeResult } from '@/features/academy/types';

const PASS_THRESHOLD = 70;   // configurable gate per spec

/**
 * L12 — Mastery check (gate to the next unit) + L13 results. Aggregates one
 * question per objective in the topic. Pass ≥ 70% to unlock the next unit.
 */
export default function MasteryCheck() {
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const objectives = useObjectives(topicId);
  const submit = useSubmitPractice();

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [started, setStarted] = useState(false);

  // Assemble the check from each objective's bank.
  useEffect(() => {
    if (!started || !objectives.data) return;
    (async () => {
      const collected: Question[] = [];
      for (const o of objectives.data!) {
        const qs = await getPractice(o.id);
        if (qs[0]) collected.push(qs[0]);
      }
      setQuestions(collected.length ? collected : await getPractice());
    })();
  }, [started, objectives.data]);

  const q = questions?.[idx];
  const selected = q ? answers[q.id] ?? [] : [];
  const isLast = questions ? idx === questions.length - 1 : false;

  const next = () => {
    if (!questions) return;
    if (isLast) {
      submit.mutate(
        { answers: Object.entries(answers).map(([questionId, sel]) => ({ questionId, selected: sel })) },
        { onSuccess: (r) => setResult(r) },
      );
    } else setIdx((i) => i + 1);
  };

  // ── Intro ───────────────────────────────────────────────────────────────────
  if (!started) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Mastery check" />
        <View style={styles.introWrap}>
          <View style={styles.introIcon}><Target size={32} color={Colors.primary} /></View>
          <Text style={styles.introTitle}>Prove your mastery</Text>
          <Text style={styles.introSub}>Answer one question per objective. Score {PASS_THRESHOLD}% or more to unlock the next unit. This works offline.</Text>
        </View>
        <View style={styles.footer}><PrimaryButton label="Start check" onPress={() => setStarted(true)} /></View>
      </SafeAreaView>
    );
  }

  if (!questions) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Preparing your check…" /></SafeAreaView>;

  // ── Result (L13) ────────────────────────────────────────────────────────────
  if (result) {
    const passed = result.scorePct >= PASS_THRESHOLD;
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Mastery result" showBack={false} />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.scoreCard, shadow1, { backgroundColor: passed ? Colors.iconBgTeal : Colors.iconBgGold }]}>
            {passed ? <Unlock size={28} color={Colors.teal} /> : <Lock size={28} color={Colors.onWarning} />}
            <Text style={styles.scoreNum}>{result.scorePct}%</Text>
            <Text style={styles.scoreSub}>{passed ? 'Unit unlocked! Next unit is now open.' : `You need ${PASS_THRESHOLD}% to unlock. Review and try again.`}</Text>
          </View>
          {result.breakdown.map((b) => (
            <View key={b.questionId} style={[styles.reviewCard, shadow1, { borderLeftColor: b.correct ? Colors.teal : Colors.error }]}>
              <Text style={styles.reviewStem}>{b.stem}</Text>
              <Text style={[styles.reviewStatus, { color: b.correct ? Colors.teal : Colors.error }]}>{b.correct ? 'Correct' : 'Incorrect'}</Text>
              <Text style={styles.reviewExpl}>{b.explanation}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.footer}>
          {passed
            ? <PrimaryButton label="Continue" onPress={() => goBack('/learn/academy')} />
            : <PrimaryButton label="Review & retry" variant="secondary" onPress={() => { setResult(null); setIdx(0); setAnswers({}); }} />}
        </View>
      </SafeAreaView>
    );
  }

  // ── Question ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Mastery · ${idx + 1}/${questions.length}`} />
      <OfflineBanner />
      <View style={styles.progressWrap}><ProgressBar pct={(idx / questions.length) * 100} /></View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {q ? (
          <QuestionCard
            question={q}
            selected={selected}
            onSelect={(opt) => setAnswers((a) => ({ ...a, [q.id]: [opt] }))}
          />
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={isLast ? 'Submit check' : 'Next'} onPress={next} disabled={selected.length === 0} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  introWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  introIcon: { width: 72, height: 72, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  introTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  introSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  progressWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  scoreCard: { alignItems: 'center', borderRadius: Radius.lg, padding: Spacing.lg, gap: 4 },
  scoreNum: { ...Typography.displayLg, color: Colors.onSurface, fontSize: 44, letterSpacing: -0.88, lineHeight: 50 },
  scoreSub: { ...Typography.bodyMd, color: Colors.onSurface, textAlign: 'center' },
  reviewCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderLeftWidth: 4 },
  reviewStem: { ...Typography.bodyMd, color: Colors.onSurface },
  reviewStatus: { ...Typography.labelSm, fontWeight: '700', marginTop: 4 },
  reviewExpl: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 4 },
});
