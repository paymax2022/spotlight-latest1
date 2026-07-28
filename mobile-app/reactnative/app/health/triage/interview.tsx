import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { TriageScaffold } from '@/features/triage/components';
import { useSubmitAnswer, useSubmitIntake } from '@/features/triage/hooks';
import { useLanguage } from '@/features/triage/useLanguage';
import { t } from '@/features/triage/i18n';
import type { TriageQuestion } from '@/features/triage/types';

export default function TriageInterviewScreen() {
  const params = useLocalSearchParams<{ sessionId?: string; profileId?: string }>();
  const sessionId = params.sessionId;
  const [lang, setLang] = useLanguage();
  const s = t(lang);

  const intake = useSubmitIntake(sessionId);
  const answer = useSubmitAnswer(sessionId);

  const [question, setQuestion] = useState<TriageQuestion | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [step, setStep] = useState(1);
  const [booting, setBooting] = useState(true);

  // Kick the loop: re-submit a no-op intake to fetch the first pending question.
  // (Intake already ran on the previous screen; this fetches the next step.)
  useEffect(() => {
    if (!sessionId) return;
    intake.mutate(
      { rawText: '' },
      {
        onSuccess: (res) => {
          handleStep(res.question, res.redFlag, res.disposition);
          setBooting(false);
        },
        onError: () => setBooting(false),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function handleStep(
    q: TriageQuestion | undefined,
    redFlag: boolean | undefined,
    disposition: number | undefined,
  ) {
    if (redFlag || disposition === 1 || disposition === 2) {
      router.replace({ pathname: '/health/triage/emergency', params: { sessionId } });
      return;
    }
    if (!q) {
      router.replace({ pathname: '/health/triage/result', params: { sessionId, profileId: params.profileId } });
      return;
    }
    setQuestion(q);
    setSelected([]);
  }

  const toggle = (value: string) => {
    if (!question) return;
    if (question.type === 'multi_select') {
      setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
    } else {
      setSelected([value]);
    }
  };

  const onNext = () => {
    if (!question || selected.length === 0 || !sessionId) return;
    const value = question.type === 'multi_select' ? selected : selected[0];
    answer.mutate(
      { code: question.code, value },
      {
        onSuccess: (res) => {
          setStep((n) => n + 1);
          handleStep(res.question, res.redFlag, res.disposition);
        },
      },
    );
  };

  if (booting) {
    return (
      <TriageScaffold title={s.interviewTitle} lang={lang} onChangeLang={setLang} sessionId={sessionId}>
        <StateView kind="loading" message="…" />
      </TriageScaffold>
    );
  }

  return (
    <TriageScaffold title={s.interviewTitle} lang={lang} onChangeLang={setLang} sessionId={sessionId}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Progress */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(step * 28, 92)}%` }]} />
        </View>
        <Text style={styles.stepLabel}>Question {step}</Text>

        {question ? (
          <>
            <Text style={styles.question}>{question.text}</Text>
            <View style={styles.options}>
              {question.options.map((opt) => {
                const active = selected.includes(opt.value);
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => toggle(opt.value)}
                    style={[styles.option, shadow1, active && styles.optionActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]}>{opt.label}</Text>
                    {active ? <Check size={20} color={Colors.onPrimary} strokeWidth={2.5} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <StateView kind="loading" message="…" />
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={s.continue}
          onPress={onNext}
          disabled={selected.length === 0}
          loading={answer.isPending}
        />
      </View>
    </TriageScaffold>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  progressTrack: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
  stepLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  question: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.xs },
  options: { gap: Spacing.sm, marginTop: Spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 60, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  optionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionText: { ...Typography.bodyLg, color: Colors.onSurface, flex: 1 },
  optionTextActive: { color: Colors.onPrimary },
  footer: {
    padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
