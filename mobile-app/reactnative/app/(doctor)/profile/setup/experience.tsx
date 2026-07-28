import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';
import { EXPERIENCE_OPTIONS, clampYearsExperience } from '@/features/doctor/constants';

export default function ExperienceScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();
  const [years, setYears] = useState<number | null>(null);

  useEffect(() => {
    if (draft && years === null) setYears(draft.yearsExperience);
  }, [draft, years]);

  const value = years ?? 0;
  const canSubmit = years !== null;

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { yearsExperience: clampYearsExperience(value), completedSteps: [...new Set([...draft.completedSteps, 'experience' as const])] } });
      router.push('/(doctor)/profile/setup/languages');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Years of experience" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Years of experience" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Years of experience" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={6} total={19} label="Years of experience" />

        <SectionCard title="How long have you practised?" style={styles.card}>
          <View style={styles.grid}>
            {EXPERIENCE_OPTIONS.map((opt) => {
              const on = value === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setYears(opt.value)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={opt.label}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </SectionCard>

        <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} disabled={!canSubmit} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:       { marginBottom: Spacing.md },
  grid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip:       { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow },
  chipOn:     { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chipText:   { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextOn: { color: Colors.primary },
  btn:        { marginTop: Spacing.sm },
});
