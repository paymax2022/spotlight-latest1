import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';
import { SPECIALTY_OPTIONS } from '@/features/doctor/constants';

export default function SpecialtyScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();
  const [specialtyId, setSpecialtyId] = useState<string | null>(null);

  useEffect(() => {
    if (draft && specialtyId === null) setSpecialtyId(draft.specialtyId);
  }, [draft, specialtyId]);

  const current = SPECIALTY_OPTIONS.find((s) => s.id === specialtyId);
  const canSubmit = !!specialtyId;

  const handleNext = async () => {
    if (!draft || !specialtyId) return;
    try {
      await save.mutateAsync({ draft: { specialtyId, completedSteps: [...new Set([...draft.completedSteps, 'specialty' as const])] } });
      router.push('/(doctor)/profile/setup/sub-specialty');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Medical specialty" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Medical specialty" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Medical specialty" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={4} total={19} label="Medical specialty" />

        <SectionCard title="Primary specialty" style={styles.card}>
          <Text style={styles.hint}>Select the specialty you primarily practise in.</Text>
          <SelectField
            label="Specialty"
            placeholder="Select specialty"
            value={current?.label}
            options={SPECIALTY_OPTIONS.map((s) => s.label)}
            onChange={(label) => setSpecialtyId(SPECIALTY_OPTIONS.find((s) => s.label === label)?.id ?? null)}
          />
        </SectionCard>

        <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} disabled={!canSubmit} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:    { marginBottom: Spacing.md },
  hint:    { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  btn:     { marginTop: Spacing.sm },
});
