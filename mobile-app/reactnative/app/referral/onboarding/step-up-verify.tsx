import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, CircleCheck, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';

// M-ONB-08 — Step-up verification. Extra KYC for elevated earning roles.
// Reuses the super-app KYC flow; this screen frames why and routes there.
const STEPS = [
  { done: true,  label: 'BVN or NIN linked', detail: 'Your base identity is already verified.' },
  { done: false, label: 'Photo ID + liveness', detail: 'Confirm it’s really you with a quick selfie check.' },
  { done: false, label: 'Proof of address', detail: 'Upload a recent utility bill or bank statement.' },
];

export default function StepUpVerify() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="Verify to unlock" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><ShieldCheck size={28} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
          <Text style={styles.title}>Step-up verification</Text>
          <Text style={styles.subtitle}>Elevated earning roles need extra checks. This protects everyone and keeps earnings fair.</Text>
        </View>

        <View style={styles.steps}>
          {STEPS.map((s, i) => (
            <View key={i} style={styles.step}>
              <View style={[styles.stepIcon, s.done && styles.stepIconDone]}>
                {s.done ? <CircleCheck size={18} color={Colors.tertiaryContainer} strokeWidth={2.2} /> : <Clock size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepLabel}>{s.label}</Text>
                <Text style={styles.stepDetail}>{s.detail}</Text>
              </View>
            </View>
          ))}
        </View>

        <DisclosureCard
          tone="info"
          body="We use your existing super-app KYC. You’ll be taken to the secure verification flow and brought back when you’re done."
        />
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Start verification" onPress={() => router.push('/kyc')} />
        <PrimaryButton label="Maybe later" variant="ghost" onPress={() => router.replace('/referral/(tabs)/home')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.xl, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  steps: { gap: Spacing.md },
  step: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  stepIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  stepIconDone: { backgroundColor: Colors.iconBgTeal },
  stepLabel: { ...Typography.labelLg, color: Colors.onSurface },
  stepDetail: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },
});
