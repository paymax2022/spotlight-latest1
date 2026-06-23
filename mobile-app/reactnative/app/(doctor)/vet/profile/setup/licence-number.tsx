import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useVetProfileDraft, useSaveVetProfileDraft } from '@/features/doctor/hooks';
import { VET_LICENCE_BODIES } from '@/features/doctor/constants';
import type { VetLicenceInfo, VetLicenceBody } from '@/types/doctor.batch1';

export default function VetLicenceNumberScreen() {
  const { data: draft, isLoading, isError, refetch } = useVetProfileDraft();
  const save = useSaveVetProfileDraft();
  const [form, setForm] = useState<VetLicenceInfo | null>(null);

  useEffect(() => {
    if (draft && !form) setForm(draft.licence);
  }, [draft, form]);

  const set = (patch: Partial<VetLicenceInfo>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const canSubmit = !!form && form.licenceNumber.trim().length > 0;

  const handleNext = async () => {
    if (!draft || !form) return;
    try {
      await save.mutateAsync({ draft: { licence: form, completedSteps: [...new Set([...draft.completedSteps, 'licence_number' as const])] } });
      router.push('/(doctor)/vet/profile/setup/licence-upload');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Veterinary licence" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || !form) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Veterinary licence" />
        <StateView variant="error" message="We could not load your licence." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const bodyLabel = VET_LICENCE_BODIES.find((b) => b.value === form.issuingBody)?.label;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Veterinary licence" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={4} total={10} label="Veterinary licence number" />

          <SectionCard title="Licence details" style={styles.card}>
            <Text style={styles.hint}>Enter your veterinary registration number as it appears on the register.</Text>
            <SelectField
              label="Issuing body"
              placeholder="Select issuing body"
              value={bodyLabel}
              options={VET_LICENCE_BODIES.map((b) => b.label)}
              onChange={(label) => set({ issuingBody: (VET_LICENCE_BODIES.find((b) => b.label === label)?.value ?? 'VCN') as VetLicenceBody })}
              searchable={false}
            />
            <TextInputField label="Licence number" placeholder="e.g. VCN/R/0184" value={form.licenceNumber} onChangeText={(licenceNumber) => set({ licenceNumber })} autoCapitalize="characters" />
            <DatePickerField label="Issued date" value={form.issuedAt} onChange={(issuedAt) => set({ issuedAt })} />
            <DatePickerField label="Expiry date" value={form.expiresAt} onChange={(expiresAt) => set({ expiresAt })} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 20} />
          </SectionCard>

          <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  flex:    { flex: 1 },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:    { marginBottom: Spacing.md },
  hint:    { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  btn:     { marginTop: Spacing.sm },
});
