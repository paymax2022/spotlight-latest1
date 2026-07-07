import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { ScanFace, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import { useSubmitLiveness, useOnboardingDraft } from '@/features/connect/hooks/useConnect';

// ON-12 — Selfie/liveness capture. Liveness check; anti-spoof.
// The camera capture + anti-spoof run server-side; this screen frames the flow
// and reflects the result. Verification media is never logged (SAFETY §5).
const TIPS = ['Find good, even lighting', 'Remove hats and sunglasses', 'Keep your face centred', 'Follow the on-screen prompts'];

export default function Liveness() {
  const submit = useSubmitLiveness();
  const { data } = useOnboardingDraft();
  const passed = data?.livenessState === 'passed' || submit.data?.livenessState === 'passed';

  const onCapture = () => {
    submit.mutate(undefined, {
      onSuccess: () => router.push('/connect/onboarding/tier-intro'),
    });
  };

  return (
    <OnboardingStep
      step={7}
      totalSteps={8}
      title="Liveness check"
      subtitle="A quick selfie confirms you’re a real, live person. This is required to activate your profile — it takes about 10 seconds."
      primaryLabel={passed ? 'Continue' : 'Start liveness check'}
      onPrimary={passed ? () => router.push('/connect/onboarding/tier-intro') : onCapture}
      primaryLoading={submit.isPending}
      footerNote="Your selfie is encrypted and used only for verification. It is never shown on your profile."
    >
      <View style={styles.frameWrap}>
        <View style={[styles.frame, passed && styles.framePassed]}>
          {passed ? (
            <CircleCheck size={56} color={Colors.teal} strokeWidth={1.6} />
          ) : (
            <ScanFace size={56} color={Colors.primary} strokeWidth={1.4} />
          )}
        </View>
        <Text style={[styles.status, passed && styles.statusOk]}>
          {passed ? 'Liveness verified' : submit.isPending ? 'Checking…' : 'Ready when you are'}
        </Text>
      </View>

      <View style={styles.tips}>
        {TIPS.map((t) => (
          <View key={t} style={styles.tipRow}>
            <View style={styles.dot} />
            <Text style={styles.tipText}>{t}</Text>
          </View>
        ))}
      </View>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  frameWrap: { alignItems: 'center', gap: Spacing.md },
  frame: {
    width: 180, height: 180, borderRadius: Radius.full,
    borderWidth: 3, borderColor: Colors.primary, borderStyle: 'dashed',
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  framePassed: { borderColor: Colors.teal, borderStyle: 'solid', backgroundColor: Colors.iconBgTeal },
  status: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  statusOk: { color: Colors.teal },
  tips: { gap: Spacing.sm, marginTop: Spacing.sm },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: Colors.secondary },
  tipText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
});
