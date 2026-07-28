import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Award, ShieldCheck, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import QuestionCard from '@/features/academy/components/QuestionCard';
import { useAssessment, useTakeAssessment } from '@/features/academy/hooks';
import type { AssessmentResult } from '@/features/academy/types';

/** S4 — Practical skill assessment. Pass → verifiable trade credential (S5). */
export default function SkillAssessmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const asm = useAssessment(id);
  const take = useTakeAssessment();
  const [answers, setAnswers] = React.useState<Record<string, string[]>>({});
  const [result, setResult] = React.useState<AssessmentResult | null>(null);

  if (asm.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading assessment…" /></SafeAreaView>;
  if (asm.isError || !asm.data) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="error" title="Not found" message="This assessment is unavailable." /></SafeAreaView>;

  const a = asm.data;

  if (result) return <ResultView result={result} />;

  const select = (qid: string, optId: string) => {
    setAnswers((prev) => {
      const q = a.questions.find((x) => x.id === qid)!;
      if (q.type === 'multi') {
        const cur = prev[qid] ?? [];
        return { ...prev, [qid]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId] };
      }
      return { ...prev, [qid]: [optId] };
    });
  };

  const allAnswered = a.questions.every((q) => (answers[q.id]?.length ?? 0) > 0);

  const onSubmit = () => {
    take.mutate(
      { assessmentId: a.id, input: { answers: a.questions.map((q) => ({ questionId: q.id, selected: answers[q.id] ?? [] })) } },
      { onSuccess: (r) => setResult(r) },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={a.title} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.info, shadow1]}>
          <View style={styles.infoItem}><ShieldCheck size={16} color={Colors.primary} /><Text style={styles.infoText}>Pass mark {a.passMark}%</Text></View>
          <View style={styles.infoItem}><Clock size={16} color={Colors.primary} /><Text style={styles.infoText}>{a.durationMin} min</Text></View>
          <View style={styles.infoItem}><Award size={16} color={Colors.primary} /><Text style={styles.infoText}>Pass earns a credential</Text></View>
        </View>

        {a.questions.map((q, i) => (
          <View key={q.id} style={[styles.qCard, shadow1]}>
            <Text style={styles.qNum}>Question {i + 1} of {a.questions.length}</Text>
            <QuestionCard question={q} selected={answers[q.id] ?? []} onSelect={(opt) => select(q.id, opt)} />
          </View>
        ))}

        <PrimaryButton label="Submit assessment" onPress={onSubmit} loading={take.isPending} disabled={!allAnswered} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ResultView({ result }: { result: AssessmentResult }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Result" showBack={false} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <LinearGradient colors={result.passed ? Colors.gradientCard : Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
          <Award size={36} color={Colors.gold} />
          <Text style={styles.heroPct}>{result.scorePct}%</Text>
          <Text style={styles.heroLabel}>{result.passed ? 'Passed — credential issued' : `Not passed (need ${result.passMark}%)`}</Text>
          <Text style={styles.heroSub}>+{result.pointsEarned} reward points</Text>
        </LinearGradient>

        {result.passed && result.credentialId ? (
          <PrimaryButton label="View my credential" onPress={() => router.replace(`/learn/academy/certificates/${result.credentialId}`)} />
        ) : (
          <PrimaryButton label="Back to track" onPress={() => router.replace('/learn/academy/trade')} />
        )}
        <PrimaryButton label="Done" onPress={() => router.replace('/learn/academy/trade')} variant="ghost" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  info: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 8 },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { ...Typography.bodyMd, color: Colors.onSurface },
  qCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 8 },
  qNum: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  hero: { borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 4 },
  heroPct: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 48, lineHeight: 54 },
  heroLabel: { ...Typography.titleMd, color: Colors.onPrimary, textAlign: 'center' },
  heroSub: { ...Typography.labelMd, color: Colors.inversePrimary },
});
