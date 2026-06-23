import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useCompleteOnboardingStep } from '@/features/crowdfunding/hooks/useInvestment';
import type { InvestorRiskProfile } from '@/features/crowdfunding/types/investment.types';

const QUESTIONS: { id: string; q: string; options: { label: string; score: number }[] }[] = [
  { id: 'q1', q: 'How would you react if an investment lost 30% of its value?', options: [
    { label: 'Sell immediately to avoid more loss', score: 1 },
    { label: 'Wait and see', score: 2 },
    { label: 'Invest more at the lower price', score: 3 },
  ]},
  { id: 'q2', q: 'What is your primary goal?', options: [
    { label: 'Protect my capital', score: 1 },
    { label: 'Balanced growth', score: 2 },
    { label: 'Maximise returns, accept high risk', score: 3 },
  ]},
  { id: 'q3', q: 'How long can you leave money invested?', options: [
    { label: 'Less than a year', score: 1 },
    { label: '1–3 years', score: 2 },
    { label: '3+ years', score: 3 },
  ]},
];

function profileFromScore(total: number): InvestorRiskProfile {
  if (total <= 4) return 'CONSERVATIVE';
  if (total <= 7) return 'BALANCED';
  return 'AGGRESSIVE';
}

export default function RiskProfileScreen() {
  const complete = useCompleteOnboardingStep();
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const allAnswered = QUESTIONS.every((q) => answers[q.id] != null);
  const total = Object.values(answers).reduce((s, v) => s + v, 0);
  const result = allAnswered ? profileFromScore(total) : null;

  const save = () => {
    if (!result) return;
    complete.mutate({ step: 'risk', riskProfile: result }, { onSuccess: () => router.back() });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Risk profile" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Answer a few questions so we can match offers to your risk appetite and apply the right limits.</Text>
        {QUESTIONS.map((q) => (
          <View key={q.id} style={styles.card}>
            <Text style={styles.question}>{q.q}</Text>
            {q.options.map((opt) => {
              const selected = answers[q.id] === opt.score;
              return (
                <Pressable key={opt.label} onPress={() => setAnswers((a) => ({ ...a, [q.id]: opt.score }))} style={[styles.option, selected && styles.optionSelected]} accessibilityRole="radio" accessibilityState={{ selected }}>
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        {result && (
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Your profile</Text>
            <Text style={styles.resultValue}>{result[0] + result.slice(1).toLowerCase()}</Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Save risk profile" onPress={save} disabled={!allAnswered} loading={complete.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  question: { ...Typography.titleMd, color: Colors.onSurface },
  option: { borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, padding: Spacing.md },
  optionSelected: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLowest },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface },
  optionTextSelected: { fontWeight: '600' as const },
  resultCard: { backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center' },
  resultLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  resultValue: { ...Typography.titleLg, color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
