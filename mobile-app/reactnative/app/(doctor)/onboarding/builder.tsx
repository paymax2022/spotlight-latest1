import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Stethoscope, HeartPulse, PawPrint } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, ProviderTypeCard } from '@/features/doctor/components';
import { useMerchantUpgradeStatus, useSelectProviderType } from '@/features/doctor/hooks';
import { PROVIDER_TYPE_OPTIONS } from '@/features/doctor/constants';
import type { ProviderType } from '@/types/doctor.onboarding';

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
  const selectType = useSelectProviderType();
  const [saveError, setSaveError] = React.useState<string>();

  const type = status?.selectedType;

  const chooseType = async (t: ProviderType) => {
    setSaveError(undefined);
    try {
      await selectType.mutateAsync({ providerType: t });
    } catch {
      setSaveError('Could not save your choice. Please try again.');
    }
  };

  const openBuilder = (t: ProviderType) => {
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
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.pickTitle}>{type ? 'Provider type' : 'What kind of provider are you?'}</Text>
          <Text style={styles.pickSub}>
            {type ? 'Tap another type to switch — your profile builder follows your choice.' : 'Pick one to start building your profile.'}
          </Text>
          <View style={styles.pickList}>
            {PROVIDER_TYPE_OPTIONS.map((opt) => (
              <ProviderTypeCard
                key={opt.type}
                label={opt.label}
                description={opt.description}
                icon={TYPE_META[opt.type].icon}
                selected={type === opt.type}
                onPress={() => chooseType(opt.type)}
                disabled={selectType.isPending}
              />
            ))}
          </View>
          {!!saveError && <Text style={styles.pickError}>{saveError}</Text>}

          {type ? (
            <>
              <SectionCard title="Next: build your profile" style={styles.card}>
                <Text style={styles.cardText}>
                  {TYPE_META[type].sub} You'll complete each step, then submit for verification. You can return any time to finish.
                </Text>
              </SectionCard>

              <PrimaryButton label="Open profile builder" onPress={() => openBuilder(type)} style={styles.btn} />
            </>
          ) : null}
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
  pickTitle:  { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.xs },
  pickSub:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  pickList:   { marginBottom: Spacing.sm },
  pickError:  { ...Typography.labelMd, color: Colors.error, marginBottom: Spacing.sm, textAlign: 'center' },
  intro:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  introIcon:  { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  introTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  introSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:       { marginBottom: Spacing.md },
  cardText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  btn:        { marginTop: Spacing.xs },
});
