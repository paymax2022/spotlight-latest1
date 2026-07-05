import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Lightbulb, Trophy } from 'lucide-react-native';
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
import { usePractice, useSubmitPractice } from '@/features/academy/hooks';
import { formatPoints } from '@/features/academy/constants';
import type { PracticeResult } from '@/features/academy/types';

/**
 * L9 — Practice question (MCQ + hints + instant feedback) and L13 — results &
 * remediation. Answers grade locally (mock) and the reward points queue offline.
 */
export default function PracticeScreen() {
  const { objectiveId } = useLocalSearchParams<{ objectiveId: string }>();
  const questions = usePractice(objectiveId);
  const submit = useSubmitPractice();

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [showHint, setShowHint] = useState(false);
  const [revealed, setRevealed] = useState(false);     // instant feedback for current
  const [result, setResult] = useState<PracticeResult | null>(null);

  const list = questions.data ?? [];
  const q = list[idx];
  const selected = q ? answers[q.id] ?? [] : [];
  const isLast = idx === list.length - 1;

  const select = (optionId: string) => {
    if (!q) return;
    setAnswers((a) => ({ ...a, [q.id]: q.type === 'multi' ? toggle(a[q.id] ?? [], optionId) : [optionId] }));
  };

  const checkOrNext = () => {
    if (!revealed) { setRevealed(true); return; }   // first tap = check (instant feedback)
    if (isLast) {
      submit.mutate(
        { objectiveId, answers: Object.entries(answers).map(([questionId, sel]) => ({ questionId, selected: sel })) },
        { onSuccess: (r) => setResult(r) },
      );
    } else {
      setIdx((i) => i + 1);
      setShowHint(false);
      setRevealed(false);
    }
  };

  if (questions.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading practice…" /></SafeAreaView>;
  if (!list.length) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Practice" /><StateView kind="empty" title="No questions yet" /></SafeAreaView>;

  // ── Results (L13) ───────────────────────────────────────────────────────────
  if (result) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Results" showBack={false} />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.scoreCard, shadow1]}>
            <Trophy size={28} color={result.scorePct >= 70 ? Colors.gold : Colors.onSurfaceVariant} />
            <Text style={styles.scoreNum}>{result.scorePct}%</Text>
            <Text style={styles.scoreSub}>{result.correct} of {result.total} correct</Text>
            <View style={[styles.pointsPill, { backgroundColor: Colors.iconBgTeal }]}>
              <Text style={styles.pointsText}>+{formatPoints(result.pointsEarned)} earned</Text>
            </View>
            {result.masteryGained ? <Text style={styles.masteryNote}>Mastery improved → {result.newMastery}</Text> : <Text style={styles.masteryNote}>Keep practising to reach proficiency (70%).</Text>}
          </View>

          <Text style={styles.section}>Worked explanations</Text>
          {result.breakdown.map((b) => (
            <View key={b.questionId} style={[styles.reviewCard, shadow1, { borderLeftColor: b.correct ? Colors.teal : Colors.error }]}>
              <Text style={styles.reviewStem}>{b.stem}</Text>
              <Text style={[styles.reviewStatus, { color: b.correct ? Colors.teal : Colors.error }]}>{b.correct ? 'Correct' : 'Incorrect'}</Text>
              <Text style={styles.reviewExpl}>{b.explanation}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Question (L9) ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Question ${idx + 1} of ${list.length}`} />
      <OfflineBanner />
      <View style={styles.progressWrap}><ProgressBar pct={((idx) / list.length) * 100} /></View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {q ? <QuestionCard question={q} selected={selected} onSelect={select} reveal={revealed} /> : null}

        {!revealed && q?.hint ? (
          showHint ? (
            <View style={styles.hintCard}><Lightbulb size={16} color={Colors.onWarning} /><Text style={styles.hintText}>{q.hint}</Text></View>
          ) : (
            <Pressable style={styles.hintBtn} onPress={() => setShowHint(true)}>
              <Lightbulb size={16} color={Colors.secondary} /><Text style={styles.hintBtnText}>Show hint</Text>
            </Pressable>
          )
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton
          label={!revealed ? 'Check' : isLast ? 'Finish' : 'Next question'}
          onPress={checkOrNext}
          disabled={!revealed && selected.length === 0}
          loading={submit.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

function toggle(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  progressWrap: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.sm },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hintBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  hintBtnText: { ...Typography.labelMd, color: Colors.secondary },
  hintCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, padding: Spacing.md, borderRadius: Radius.md },
  hintText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  scoreCard: { alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, gap: 4 },
  scoreNum: { ...Typography.displayLg, color: Colors.onSurface, fontSize: 44, lineHeight: 50 },
  scoreSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  pointsPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, marginTop: Spacing.sm },
  pointsText: { ...Typography.labelMd, color: Colors.teal, fontWeight: '700' },
  masteryNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.lg, marginBottom: 2 },
  reviewCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderLeftWidth: 4 },
  reviewStem: { ...Typography.bodyMd, color: Colors.onSurface },
  reviewStatus: { ...Typography.labelSm, fontWeight: '700', marginTop: 4 },
  reviewExpl: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 4 },
});
