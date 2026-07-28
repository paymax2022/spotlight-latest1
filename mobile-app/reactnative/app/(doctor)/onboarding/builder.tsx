import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Stethoscope, HeartPulse, PawPrint, ArrowRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView } from '@/features/doctor/components';
import { useMerchantUpgradeStatus } from '@/features/doctor/hooks';
import type { ProviderType } from '@/types/doctor.onboarding';

// ── Section A · Entries 5 / 6 / 7 — Profile-builder hand-off (REUSE) ──────────
// A thin intro that reads the persisted provider type and forwards into the
// EXISTING profile builder — Section B (profile/setup) for doctor & specialist
// (specialist sets the `specialist` param so the specialty step is mandatory),
// Section C / Batch 1 (vet/profile/setup) for veterinarian. The builders
// themselves are NOT recreated here.

const TYPE_META: Record<ProviderType, { icon: LucideIcon; title: string; sub: string }> = {
  doctor: {
    icon: Stethoscope,
    title: 'Doctor profile',
    sub: 'Add your bio, credentials, pricing and payout details to get verified.',
  },
  specialist: {
    icon: HeartPulse,
    title: 'Specialist profile',
    sub: 'Same builder as a doctor — your specialty is a required step.',
  },
  veterinarian: {
    icon: PawPrint,
    title: 'Veterinary profile',
    sub: 'Add your species, credentials and pricing to start animal consults.',
  },
};

export default function OnboardingBuilderHandoffScreen() {
  const { data: status, isLoading, isError, refetch } = useMerchantUpgradeStatus();

  const type = status?.selectedType;

  const openBuilder = (t: ProviderType) => {
    // doctor & specialist share the Section B builder (profile/setup); the
    // specialist variant is the specialty step being mandatory inside that
    // existing builder. Veterinarian → Section C / Batch 1 builder.
    if (t === 'veterinarian') {
      router.push('/(doctor)/vet/profile/setup');
    } else {
      router.push('/(doctor)/profile/setup');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Your profile" />

      {isLoading && !status ? (
        <StateView variant="loading" label="Loading" />
      ) : isError || !status ? (
        <StateView variant="error" message="We could not load your onboarding." onRetry={() => refetch()} />
      ) : !type ? (
        <StateView variant="empty" icon={ArrowRight} title="Choose a provider type first" message="Pick the kind of provider you are before building your profile." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {(() => {
            const meta = TYPE_META[type];
            const Icon = meta.icon;
            return (
              <View style={styles.intro}>
                <View style={styles.introIcon}>
                  <Icon size={28} color={Colors.primary} strokeWidth={2} />
                </View>
                <Text style={styles.introTitle}>{meta.title}</Text>
                <Text style={styles.introSub}>{meta.sub}</Text>
              </View>
            );
          })()}

          <SectionCard title="Next: build your profile" style={styles.card}>
            <Text style={styles.cardText}>
              You'll complete each step, then submit for verification. You can return any time to finish.
            </Text>
          </SectionCard>

          <PrimaryButton label="Open profile builder" onPress={() => openBuilder(type)} style={styles.btn} />
          <PrimaryButton
            label="I've submitted — check my status"
            variant="ghost"
            onPress={() => router.push('/(doctor)/onboarding/submit')}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  intro:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  introIcon:  { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  introTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  introSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:       { marginBottom: Spacing.md },
  cardText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  btn:        { marginTop: Spacing.xs },
});
