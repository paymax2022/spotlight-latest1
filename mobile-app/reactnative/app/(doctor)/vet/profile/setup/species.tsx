import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useVetProfileDraft, useSaveVetProfileDraft } from '@/features/doctor/hooks';
import { PET_SPECIES_OPTIONS } from '@/features/doctor/constants';
import type { PetSpecies } from '@/types/doctor.batch1';

export default function VetSpeciesScreen() {
  const { data: draft, isLoading, isError, refetch } = useVetProfileDraft();
  const save = useSaveVetProfileDraft();
  const [selected, setSelected] = useState<PetSpecies[] | null>(null);

  useEffect(() => {
    if (draft && selected === null) setSelected(draft.speciesTreated);
  }, [draft, selected]);

  const picks = selected ?? [];
  const toggle = (sp: PetSpecies) =>
    setSelected((prev) => {
      const base = prev ?? [];
      return base.includes(sp) ? base.filter((s) => s !== sp) : [...base, sp];
    });

  const canSubmit = picks.length > 0;

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { speciesTreated: picks, completedSteps: [...new Set([...draft.completedSteps, 'species' as const])] } });
      router.push('/(doctor)/vet/profile/setup/licence-number');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Pet species" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || selected === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Pet species" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pet species" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={3} total={10} label="Pet species specialisation" />

        <SectionCard title="Species you treat" style={styles.card}>
          <Text style={styles.hint}>Select every animal species you are equipped to consult on.</Text>
          <View style={styles.grid}>
            {PET_SPECIES_OPTIONS.map((opt) => {
              const on = picks.includes(opt.value);
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => toggle(opt.value)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={opt.label}
                >
                  {on && <Check size={14} color={Colors.primary} strokeWidth={3} />}
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
  hint:       { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  grid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow },
  chipOn:     { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chipText:   { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextOn: { color: Colors.primary },
  btn:        { marginTop: Spacing.sm },
});
