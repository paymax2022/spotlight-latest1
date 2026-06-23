import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, ShieldCheck, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import {
  useEligibility, useAgreements, useAcceptAgreements, useStartInvesting,
  useSuitabilityQuestions, useSubmitSuitability,
} from '@/features/invest/hooks/useInvest';

type Step = 'intro' | 'terms' | 'suitability' | 'done';

export default function OnboardingScreen() {
  const eligibility = useEligibility();
  const agreements = useAgreements();
  const acceptAgreements = useAcceptAgreements();
  const start = useStartInvesting();
  const questions = useSuitabilityQuestions();
  const submit = useSubmitSuitability();

  const [step, setStep] = useState<Step>('intro');
  const [answers, setAnswers] = useState<Record<string, number>>({});

  async function beginTerms() {
    try { await start.mutateAsync(); setStep('terms'); }
    catch { setStep('terms'); }
  }

  async function acceptAndContinue() {
    try {
      await acceptAgreements.mutateAsync();
      setStep('suitability');
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.error ?? 'Please try again.');
    }
  }

  const allAnswered = (questions.data ?? []).every((q) => answers[q.id] !== undefined);

  async function finishSuitability() {
    try {
      await submit.mutateAsync(answers);
      setStep('done');
    } catch (e: any) {
      Alert.alert('Could not submit', e?.response?.data?.error ?? 'Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Get started" />
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxl }}>
        {step === 'intro' && (
          <View style={styles.pad}>
            <View style={styles.heroIcon}><TrendingUp size={28} color={Colors.primary} /></View>
            <Text style={styles.h1}>Own the companies shaping your future</Text>
            <Text style={styles.body}>
              Invest in Nigerian stocks and ETFs from your Paymax wallet. Before you trade we’ll
              confirm a few things so you can invest responsibly.
            </Text>
            <Bullet text="Learn how shares, dividends and settlement work" />
            <Bullet text="Complete a short suitability questionnaire" />
            <Bullet text="Accept the investment terms & risk disclosure" />
            <Text style={styles.disclaimer}>
              Stock prices can rise or fall. You may get back less than you invest. This is educational
              information, not financial advice.
            </Text>
            <PrimaryButton label={start.isPending ? 'Setting up…' : 'Continue'} onPress={beginTerms} loading={start.isPending} style={{ marginTop: Spacing.lg }} />
          </View>
        )}

        {step === 'terms' && (
          <View style={styles.pad}>
            <Text style={styles.h2}>Agreements</Text>
            <Text style={styles.body}>Review and accept the active agreements to continue.</Text>
            {agreements.isLoading ? (
              <StateView kind="loading" compact />
            ) : (
              <View style={[styles.card, shadow1]}>
                {(agreements.data ?? []).map((a, i) => (
                  <View key={a.key}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.agreementRow}>
                      <ShieldCheck size={18} color={Colors.secondary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.agreementTitle}>{a.title}</Text>
                        <Text style={styles.agreementVer}>Version {a.version}</Text>
                      </View>
                      {a.accepted && <Check size={18} color={Colors.teal} />}
                    </View>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.disclaimer}>By continuing you accept all agreements listed above.</Text>
            <PrimaryButton label={acceptAgreements.isPending ? 'Saving…' : 'Accept & continue'} onPress={acceptAndContinue} loading={acceptAgreements.isPending} style={{ marginTop: Spacing.lg }} />
          </View>
        )}

        {step === 'suitability' && (
          <View style={styles.pad}>
            <Text style={styles.h2}>Suitability</Text>
            <Text style={styles.body}>Help us understand your investing experience and risk tolerance.</Text>
            {questions.isLoading ? (
              <StateView kind="loading" compact />
            ) : (
              (questions.data ?? []).map((q) => (
                <View key={q.id} style={styles.qBlock}>
                  <Text style={styles.qText}>{q.text}</Text>
                  <View style={styles.options}>
                    {q.options.map((opt) => {
                      const selected = answers[q.id] === opt.value;
                      return (
                        <Pressable
                          key={opt.label}
                          onPress={() => setAnswers((a) => ({ ...a, [q.id]: opt.value }))}
                          style={[styles.option, selected && styles.optionActive]}
                        >
                          <Text style={[styles.optionText, selected && styles.optionTextActive]}>{opt.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
            <PrimaryButton
              label={submit.isPending ? 'Submitting…' : 'Submit'}
              onPress={finishSuitability}
              loading={submit.isPending}
              disabled={!allAnswered || submit.isPending}
              style={{ marginTop: Spacing.lg }}
            />
          </View>
        )}

        {step === 'done' && (
          <View style={[styles.pad, { alignItems: 'center', paddingTop: Spacing.xl }]}>
            <View style={styles.successIcon}><Check size={48} color={Colors.teal} /></View>
            <Text style={styles.h1}>You’re all set</Text>
            <Text style={[styles.body, { textAlign: 'center' }]}>
              {eligibility.data?.kyc_ok
                ? 'Your investor profile is ready. You can start investing now.'
                : 'Your profile is ready. Upgrade your KYC to tier 2 to place live trades.'}
            </Text>
            <PrimaryButton label="Start investing" onPress={() => router.replace('/invest')} style={{ marginTop: Spacing.lg }} />
            <PrimaryButton label="Browse stocks" variant="ghost" onPress={() => router.replace('/invest/discover')} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.bulletDot}><Check size={14} color={Colors.teal} /></View>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  pad: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  heroIcon: {
    width: 60, height: 60, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md,
  },
  h1: { ...Typography.headlineMd, color: Colors.onSurface },
  h2: { ...Typography.titleLg, color: Colors.onSurface },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, marginBottom: Spacing.md },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  bulletDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  bulletText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  disclaimer: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.md, fontStyle: 'italic' },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    paddingVertical: Spacing.xs, borderWidth: 1, borderColor: Colors.outlineVariant, marginTop: Spacing.sm,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  agreementRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  agreementTitle: { ...Typography.labelLg, color: Colors.onSurface },
  agreementVer: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  qBlock: { marginTop: Spacing.lg },
  qText: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.sm },
  options: { gap: Spacing.sm },
  option: {
    paddingVertical: 14, paddingHorizontal: Spacing.md, borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent,
  },
  optionActive: { borderColor: Colors.secondary, backgroundColor: Colors.secondaryFixed },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface },
  optionTextActive: { color: Colors.onSecondaryFixed, fontWeight: '600' },
  successIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.iconBgTeal,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md,
  },
});
