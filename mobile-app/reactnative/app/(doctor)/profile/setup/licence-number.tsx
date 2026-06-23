import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';
import type { ProfileLicenceInfo } from '@/types/doctor.profile';

export default function LicenceNumberScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();
  const [form, setForm] = useState<ProfileLicenceInfo | null>(null);

  useEffect(() => {
    if (draft && !form) setForm(draft.licence);
  }, [draft, form]);

  const set = (patch: Partial<ProfileLicenceInfo>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const canSubmit = !!form && form.licenceNumber.trim().length > 0 && form.issuingBody.trim().length > 0;

  const handleNext = async () => {
    if (!draft || !form) return;
    try {
      await save.mutateAsync({ draft: { licence: form, completedSteps: [...new Set([...draft.completedSteps, 'licence_number' as const])] } });
      router.push('/(doctor)/profile/setup/licence-upload');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Medical licence" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || !form) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Medical licence" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Medical licence" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={8} total={19} label="Medical licence number" />

          <SectionCard title="Licence details" style={styles.card}>
            <Text style={styles.hint}>Enter your MDCN registration details exactly as on your licence.</Text>
            <TextInputField label="MDCN registration number" placeholder="e.g. MDCN/R/45821" value={form.licenceNumber} onChangeText={(licenceNumber) => set({ licenceNumber })} autoCapitalize="characters" />
            <TextInputField label="Issuing body" placeholder="e.g. MDCN" value={form.issuingBody} onChangeText={(issuingBody) => set({ issuingBody })} />
            <DatePickerField label="Issued on" value={form.issuedAt} onChange={(issuedAt) => set({ issuedAt })} minYear={1970} maxYear={new Date().getFullYear()} />
            <DatePickerField label="Expires on" value={form.expiresAt} onChange={(expiresAt) => set({ expiresAt })} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 20} />
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
