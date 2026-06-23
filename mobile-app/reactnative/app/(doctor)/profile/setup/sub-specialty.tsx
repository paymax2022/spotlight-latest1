import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, ChipMultiSelect } from '@/features/doctor/components';
import { useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';
import { SUB_SPECIALTY_OPTIONS } from '@/features/doctor/constants';

export default function SubSpecialtyScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();
  const [selected, setSelected] = useState<string[] | null>(null);

  useEffect(() => {
    if (draft && selected === null) setSelected(draft.subSpecialtyIds);
  }, [draft, selected]);

  const value = selected ?? [];
  const canSubmit = value.length > 0;

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { subSpecialtyIds: value, completedSteps: [...new Set([...draft.completedSteps, 'sub_specialty' as const])] } });
      router.push('/(doctor)/profile/setup/experience');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Sub-specialty" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || selected === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Sub-specialty" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Sub-specialty" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={5} total={19} label="Sub-specialty" />

        <SectionCard title="Areas of focus" style={styles.card}>
          <Text style={styles.hint}>Select one or more sub-specialties you focus on.</Text>
          <ChipMultiSelect options={SUB_SPECIALTY_OPTIONS} selected={value} onChange={setSelected} />
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
