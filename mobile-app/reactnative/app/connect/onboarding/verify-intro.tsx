import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { ScanFace, CircleCheck, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';

// ON-11 — Verification intro. Why verify; tier benefits.
const BENEFITS = [
  { icon: ScanFace, title: 'Liveness check', body: 'A quick selfie proves you’re a real, live person. This is required to activate your profile.' },
  { icon: CircleCheck, title: 'A verified badge', body: 'Passing liveness adds a verified badge so others know you’re genuine.' },
  { icon: ShieldCheck, title: 'A safer community', body: 'Verification deters fakes and scams, so everyone can connect with confidence.' },
];

export default function VerifyIntro() {
  return (
    <OnboardingStep
      step={6}
      totalSteps={8}
      title="Get verified"
      subtitle="A quick liveness selfie is required to activate your profile. It takes about 10 seconds."
      primaryLabel="Start verification"
      onPrimary={() => router.push('/connect/onboarding/liveness')}
    >
      {BENEFITS.map((b) => {
        const Icon = b.icon;
        return (
          <View key={b.title} style={styles.row}>
            <View style={styles.iconBox}>
              <Icon size={22} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.body}>
              <Text style={styles.title}>{b.title}</Text>
              <Text style={styles.sub}>{b.body}</Text>
            </View>
          </View>
        );
      })}
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  iconBox: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
