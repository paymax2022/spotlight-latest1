import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, ChipMultiSelect } from '@/features/doctor/components';
import { useVetProfileDraft, useSaveVetProfileDraft } from '@/features/doctor/hooks';
import { VET_SPECIALTY_OPTIONS, VET_SUB_SPECIALTY_OPTIONS } from '@/features/doctor/constants';

export default function VetSpecialtyScreen() {
  const { data: draft, isLoading, isError, refetch } = useVetProfileDraft();
  const save = useSaveVetProfileDraft();
  const [specialtyId, setSpecialtyId] = useState<string | null>(null);
  const [subs, setSubs] = useState<string[] | null>(null);

  useEffect(() => {
    if (draft && specialtyId === null) setSpecialtyId(draft.specialtyId);
    if (draft && subs === null) setSubs(draft.subSpecialtyIds);
  }, [draft, specialtyId, subs]);

  const current = VET_SPECIALTY_OPTIONS.find((s) => s.id === specialtyId);
  const canSubmit = !!specialtyId;

  const handleNext = async () => {
    if (!draft || !specialtyId) return;
    try {
      await save.mutateAsync({ draft: { specialtyId, subSpecialtyIds: subs ?? [], completedSteps: [...new Set([...draft.completedSteps, 'specialty' as const])] } });
      router.push('/(doctor)/vet/profile/setup/species');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Veterinary specialty" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || subs === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Veterinary specialty" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Veterinary specialty" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={2} total={10} label="Veterinary specialty" />

        <SectionCard title="Primary specialty" style={styles.card}>
          <Text style={styles.hint}>Select the veterinary specialty you primarily practise in.</Text>
          <SelectField
            label="Specialty"
            placeholder="Select specialty"
            value={current?.label}
            options={VET_SPECIALTY_OPTIONS.map((s) => s.label)}
            onChange={(label) => setSpecialtyId(VET_SPECIALTY_OPTIONS.find((s) => s.label === label)?.id ?? null)}
          />
        </SectionCard>

        <SectionCard title="Sub-specialties" style={styles.card}>
          <Text style={styles.hint}>Select any areas of focus (optional).</Text>
          <ChipMultiSelect options={VET_SUB_SPECIALTY_OPTIONS} selected={subs} onChange={setSubs} />
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
