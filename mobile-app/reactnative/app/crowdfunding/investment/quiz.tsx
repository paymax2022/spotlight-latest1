import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useQuiz, useCompleteOnboardingStep } from '@/features/crowdfunding/hooks/useInvestment';

export default function InvestorQuizScreen() {
  const { data, isLoading, isError, refetch } = useQuiz();
  const complete = useCompleteOnboardingStep();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const questions = data ?? [];
  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] != null);
  const correct = questions.filter((q) => answers[q.id] === q.correctIndex).length;
  const passed = submitted && correct === questions.length;

  const submit = () => {
    setSubmitted(true);
    if (questions.every((q) => answers[q.id] === q.correctIndex)) {
      complete.mutate({ step: 'quiz' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Knowledge quiz" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load quiz" actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {submitted && (
              <View style={[styles.result, passed ? styles.resultPass : styles.resultFail]}>
                <Text style={[styles.resultText, { color: passed ? Colors.tertiaryContainer : Colors.error }]}>
                  {passed ? '✓ Passed — you got all answers right.' : `You got ${correct}/${questions.length}. Review and try again.`}
                </Text>
              </View>
            )}
            {questions.map((q, qi) => (
              <View key={q.id} style={styles.card}>
                <Text style={styles.question}>{qi + 1}. {q.question}</Text>
                {q.options.map((opt, oi) => {
                  const selected = answers[q.id] === oi;
                  const showResult = submitted;
                  const isCorrect = oi === q.correctIndex;
                  return (
                    <Pressable
                      key={oi}
                      onPress={() => !submitted && setAnswers((a) => ({ ...a, [q.id]: oi }))}
                      style={[styles.option, selected && styles.optionSelected, showResult && isCorrect && styles.optionCorrect, showResult && selected && !isCorrect && styles.optionWrong]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt}</Text>
                      {showResult && isCorrect && <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.4} />}
                      {showResult && selected && !isCorrect && <X size={16} color={Colors.error} strokeWidth={2.4} />}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            {passed ? (
              <PrimaryButton label="Continue" onPress={() => router.back()} />
            ) : submitted ? (
              <PrimaryButton label="Try again" onPress={() => { setSubmitted(false); setAnswers({}); }} />
            ) : (
              <PrimaryButton label="Submit answers" onPress={submit} disabled={!allAnswered} />
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, gap: Spacing.md },
  result: { borderRadius: Radius.lg, padding: Spacing.md },
  resultPass: { backgroundColor: Colors.iconBgTeal },
  resultFail: { backgroundColor: Colors.errorContainer },
  resultText: { ...Typography.labelMd },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  question: { ...Typography.titleMd, color: Colors.onSurface },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, padding: Spacing.md },
  optionSelected: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLowest },
  optionCorrect: { borderColor: Colors.tertiaryContainer, backgroundColor: Colors.iconBgTeal },
  optionWrong: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  optionTextSelected: { fontWeight: '600' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
