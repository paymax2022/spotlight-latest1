import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Stethoscope, HeartPulse, PawPrint } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { ProviderTypeCard, StateView } from '@/features/doctor/components';
import { useSelectProviderType, useMerchantUpgradeStatus } from '@/features/doctor/hooks';
import { PROVIDER_TYPE_OPTIONS } from '@/features/doctor/constants';
import type { ProviderType } from '@/types/doctor.onboarding';

// ── Section A · Entry 4 — Choose provider type ───────────────────────────────
// Selectable card list over PROVIDER_TYPE_OPTIONS. Records the choice via
// useSelectProviderType, then routes into the consent gate. The chosen type is
// persisted on the merchant-upgrade status so the permissions step can route to
// the correct builder (doctor/specialist → Section B; veterinarian → Section C).

const ICON_MAP: Record<ProviderType, LucideIcon> = {
  doctor:       Stethoscope,
  specialist:   HeartPulse,
  veterinarian: PawPrint,
};

export default function ProviderTypeScreen() {
  const { data: status, isLoading, isError, refetch } = useMerchantUpgradeStatus();
  const selectType = useSelectProviderType();
  const [selected, setSelected] = useState<ProviderType | undefined>(status?.selectedType);
  const [error, setError] = useState<string>();

  const handleContinue = async () => {
    if (!selected) {
      setError('Select the type of provider you are.');
      return;
    }
    setError(undefined);
    try {
      await selectType.mutateAsync({ type: selected });
      // Gate: consents → permissions → builder. The builder is reached from the
      // permissions step using the persisted selectedType.
      router.push('/(doctor)/onboarding/consents');
    } catch {
      setError('Could not save your choice. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Provider type" />

      {isLoading && !status ? (
        <StateView variant="loading" label="Loading" />
      ) : isError || !status ? (
        <StateView variant="error" message="We could not load your onboarding." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.heading}>What kind of provider are you?</Text>
          <Text style={styles.sub}>This sets up the right profile builder for your practice.</Text>

          <View style={styles.list}>
            {PROVIDER_TYPE_OPTIONS.map((opt) => (
              <ProviderTypeCard
                key={opt.type}
                label={opt.label}
                description={opt.description}
                icon={ICON_MAP[opt.type]}
                selected={selected === opt.type}
                onPress={() => setSelected(opt.type)}
                disabled={selectType.isPending}
              />
            ))}
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <PrimaryButton
            label="Continue"
            onPress={handleContinue}
            loading={selectType.isPending}
            disabled={!selected}
            style={styles.btn}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  heading: { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.xs },
  sub:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.lg },
  list:    { marginBottom: Spacing.sm },
  error:   { ...Typography.labelMd, color: Colors.error, marginBottom: Spacing.sm, textAlign: 'center' },
  btn:     { marginTop: Spacing.sm },
});
