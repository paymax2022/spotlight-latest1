import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import {
  ONBOARDING_INTRO_STEPS,
  TRUST_MARKERS,
  RISK_DISCLOSURE_SHORT,
} from '@/features/investonboarding/constants/onboarding.constants';
import { resetMockState } from '@/features/investonboarding/api/onboarding.mock';
import { resetKycDraft, resetSuitabilityDraft } from '@/features/investonboarding/utils/onboardingDraft';

export default function OnboardingIntroScreen() {
  const start = () => {
    // Fresh run: clear any in-flight client state (mock session only).
    resetKycDraft();
    resetSuitabilityDraft();
    resetMockState();
    router.push('/invest-onboarding/eligibility');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Paymax Invest" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <ShieldCheck size={32} color={Colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>Learn. Fund. Invest. Grow.</Text>
          <Text style={styles.heroSub}>
            Set up your invest account in a few minutes. We will verify you, learn your goals,
            and unlock crypto and stocks that suit you.
          </Text>
        </View>

        <View style={styles.steps}>
          {ONBOARDING_INTRO_STEPS.map((s, i) => {
            const Glyph = (Icons as unknown as Record<string, Icons.LucideIcon>)[s.icon] ?? Icons.Circle;
            return (
              <View key={s.title} style={styles.stepRow}>
                <View style={styles.stepIcon}>
                  <Glyph size={20} color={Colors.primary} strokeWidth={1.8} />
                </View>
                <View style={styles.stepText}>
                  <Text style={styles.stepTitle}>{i + 1}. {s.title}</Text>
                  <Text style={styles.stepBody}>{s.body}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.trust}>
          {TRUST_MARKERS.map((m) => (
            <View key={m} style={styles.trustChip}>
              <Icons.BadgeCheck size={14} color={Colors.teal} strokeWidth={2} />
              <Text style={styles.trustText}>{m}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.disclosure}>{RISK_DISCLOSURE_SHORT}</Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Get started" onPress={start} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm },
  heroIcon: {
    width: 72, height: 72, borderRadius: Radius.xl,
    backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  steps: { gap: Spacing.md },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center',
  },
  stepText: { flex: 1 },
  stepTitle: { ...Typography.labelLg, color: Colors.onSurface },
  stepBody: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  trust: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  trustChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  trustText: { ...Typography.labelSm, color: Colors.onSurface },
  disclosure: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
