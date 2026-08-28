import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Award, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import ProgressBar from '@/features/learn/components/ProgressBar';
import QuizOption from '@/features/learn/components/QuizOption';
import { useQuiz, useSubmitQuiz } from '@/features/learn/hooks/useLearn';
import type { QuizAnswers, QuizResult } from '@/features/learn/types/learn.types';

export default function QuizScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const quiz = useQuiz(lessonId);
  const submit = useSubmitQuiz();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);

  const questions = quiz.data?.questions ?? [];
  const current = questions[index];
  const isLast = index === questions.length - 1;
  const selectedId = current ? answers[current.id] : undefined;

  const reset = () => {
    setIndex(0); setAnswers({}); setRevealed(false); setResult(null); submit.reset();
  };

  const onNext = () => {
    if (!quiz.data || !current) return;
    if (!revealed) { setRevealed(true); return; }     // reveal correct answer first
    if (isLast) {
      submit.mutate(
        { quizId: quiz.data.id, answers },
        { onSuccess: (r) => setResult(r) },
      );
      return;
    }
    setIndex((i) => i + 1);
    setRevealed(false);
  };

  if (quiz.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Quiz" />
        <StateView kind="loading" message="Loading the quiz…" />
      </SafeAreaView>
    );
  }

  if (quiz.isError || !quiz.data || questions.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Quiz" />
        <StateView kind="empty" icon="HelpCircle" title="No quiz here" message="This lesson doesn't have a quiz yet." actionLabel="Back to lesson" onAction={() => goBack('/learn')} />
      </SafeAreaView>
    );
  }

  // ─── Result view ────────────────────────────────────────────────────────────
  if (result) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Your result" showBack={false} />
        <ScrollView contentContainerStyle={styles.resultScroll}>
          <View style={[styles.resultIcon, result.passed ? styles.resultIconPass : styles.resultIconFail]}>
            {result.passed
              ? <Award size={40} color={Colors.teal} strokeWidth={1.8} />
              : <XCircle size={40} color={Colors.error} strokeWidth={1.8} />}
          </View>
          <Text style={styles.resultTitle}>{result.passed ? 'Nice work!' : 'Keep going'}</Text>
          <Text style={styles.resultScoreText}>
            You scored {result.score} of {result.total}
          </Text>
          <Text style={styles.resultSub}>
            {result.passed
              ? 'You\'ve got the key ideas down. Move on to the next lesson when you\'re ready.'
              : 'Review the lesson and try again — repetition is how it sticks.'}
          </Text>

          <View style={styles.resultActions}>
            <PrimaryButton label="Retake quiz" onPress={reset} variant="secondary" />
            <PrimaryButton label="Back to lesson" onPress={() => goBack('/learn')} variant="ghost" />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Question view ──────────────────────────────────────────────────────────
  const progress = ((index + (revealed ? 1 : 0)) / questions.length) * 100;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Quiz" subtitle={`Question ${index + 1} of ${questions.length}`} />

      <View style={styles.progressWrap}>
        <ProgressBar pct={progress} color={Colors.primary} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.promptCard, shadow1]}>
          <Text style={styles.prompt}>{current.prompt}</Text>
        </View>

        <View style={styles.options}>
          {current.options.map((opt) => (
            <QuizOption
              key={opt.id}
              label={opt.label}
              selected={selectedId === opt.id}
              correct={opt.correct}
              revealed={revealed}
              onPress={() => setAnswers((a) => ({ ...a, [current.id]: opt.id }))}
            />
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={!revealed ? 'Check answer' : isLast ? 'See result' : 'Next question'}
          onPress={onNext}
          disabled={!selectedId}
          loading={submit.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  progressWrap: { paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },

  promptCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.cardPadding, marginTop: Spacing.sm,
  },
  prompt: { ...Typography.titleMd, color: Colors.onSurface, lineHeight: 26 },
  options: { marginTop: Spacing.lg, gap: Spacing.sm },

  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md },

  resultScroll: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
  resultIcon: {
    width: 88, height: 88, borderRadius: Radius.xxl,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm,
  },
  resultIconPass: { backgroundColor: Colors.iconBgTeal },
  resultIconFail: { backgroundColor: Colors.errorContainer },
  resultTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  resultScoreText: { ...Typography.titleMd, color: Colors.secondary },
  resultSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 24, marginTop: Spacing.xs },
  resultActions: { width: '100%', gap: Spacing.sm, marginTop: Spacing.xl },
});
