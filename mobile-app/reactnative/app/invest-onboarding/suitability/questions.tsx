import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StepHeader from '@/features/investonboarding/components/StepHeader';
import ChoiceCard from '@/features/investonboarding/components/ChoiceCard';
import { SUITABILITY_QUESTIONS } from '@/features/investonboarding/constants/onboarding.constants';
import { suitabilityDraft } from '@/features/investonboarding/utils/onboardingDraft';
import { isQuestionnaireComplete } from '@/features/investonboarding/utils/onboarding.utils';
import { useSubmitSuitability } from '@/features/investonboarding/hooks/useOnboarding';
import type { SuitabilityAnswers } from '@/features/investonboarding/types/onboarding.types';

export default function SuitabilityQuestionsScreen() {
  const total = SUITABILITY_QUESTIONS.length;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Partial<SuitabilityAnswers>>({ ...suitabilityDraft.current });
  const submit = useSubmitSuitability();

  const question = SUITABILITY_QUESTIONS[index];
  const current = answers[question.id];
  const isLast = index === total - 1;

  const choose = (value: string) => {
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    suitabilityDraft.current = next;
  };

  const onNext = async () => {
    if (!current) return;
    if (!isLast) { setIndex((i) => i + 1); return; }
    // Finished — score + submit, then show the result.
    if (!isQuestionnaireComplete(answers)) return;
    try {
      await submit.mutateAsync(answers as SuitabilityAnswers);
      router.replace('/invest-onboarding/suitability/result');
    } catch {
      /* error surfaced inline below */
    }
  };

  const onBack = () => {
    if (index === 0) { router.back(); return; }
    setIndex((i) => i - 1);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Suitability" onBack={onBack} />
      <StepHeader step={index + 1} total={total} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.question}>{question.label}</Text>
        <Text style={styles.help}>{question.help}</Text>

        <View style={styles.options}>
          {question.options.map((opt) => (
            <ChoiceCard
              key={opt.value}
              label={opt.label}
              selected={current === opt.value}
              onPress={() => choose(opt.value)}
            />
          ))}
        </View>

        {submit.isError ? (
          <Text style={styles.error}>{(submit.error as Error)?.message ?? 'Something went wrong. Please try again.'}</Text>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label={isLast ? 'See my profile' : 'Next'}
          onPress={onNext}
          disabled={!current}
          loading={submit.isPending}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingTop: 0, gap: Spacing.sm },
  question: { ...Typography.titleLg, color: Colors.onSurface },
  help: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, marginBottom: Spacing.sm },
  options: { gap: Spacing.sm },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
