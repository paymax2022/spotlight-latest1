import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useVetProfileDraft, useSaveVetProfileDraft } from '@/features/doctor/hooks';
import { NIGERIAN_STATES } from '@/features/doctor/constants';
import type { PersonalInfo } from '@/types/doctor.batch1';

const TITLE_OPTIONS = ['Dr.', 'Prof.', 'Mr.', 'Mrs.', 'Ms.'];
const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const GENDER_VALUE: Record<string, PersonalInfo['gender']> = {
  Male: 'male', Female: 'female', Other: 'other', 'Prefer not to say': 'prefer_not_to_say',
};

export default function VetPersonalInfoScreen() {
  const { data: draft, isLoading, isError, refetch } = useVetProfileDraft();
  const save = useSaveVetProfileDraft();
  const [form, setForm] = useState<PersonalInfo | null>(null);

  useEffect(() => {
    if (draft && !form) setForm(draft.personalInfo);
  }, [draft, form]);

  const set = (patch: Partial<PersonalInfo>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const canSubmit = !!form && form.firstName.trim().length > 0 && form.lastName.trim().length > 0 && form.title.trim().length > 0;

  const handleNext = async () => {
    if (!form || !draft) return;
    try {
      await save.mutateAsync({ draft: { personalInfo: form, completedSteps: [...new Set([...draft.completedSteps, 'personal_info' as const])] } });
      router.push('/(doctor)/vet/profile/setup/specialty');
    } catch { /* surfaced below */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Personal information" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || !form) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Personal information" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const genderLabel = Object.keys(GENDER_VALUE).find((k) => GENDER_VALUE[k] === form.gender);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Personal information" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={1} total={10} label="Personal information" />

          <SectionCard title="Your details" style={styles.card}>
            <SelectField label="Title" placeholder="Select title" value={form.title || undefined} options={TITLE_OPTIONS} onChange={(title) => set({ title })} searchable={false} />
            <TextInputField label="First name" placeholder="e.g. Amaka" value={form.firstName} onChangeText={(firstName) => set({ firstName })} />
            <TextInputField label="Last name" placeholder="e.g. Obi" value={form.lastName} onChangeText={(lastName) => set({ lastName })} />
            <SelectField label="Gender" placeholder="Select gender" value={genderLabel} options={GENDER_OPTIONS} onChange={(label) => set({ gender: GENDER_VALUE[label] })} searchable={false} />
            <DatePickerField label="Date of birth" value={form.dateOfBirth} onChange={(dateOfBirth) => set({ dateOfBirth })} />
          </SectionCard>

          <SectionCard title="Contact" style={styles.card}>
            <TextInputField label="Email" placeholder="you@example.com" value={form.email} onChangeText={(email) => set({ email })} keyboardType="email-address" autoCapitalize="none" />
            <TextInputField label="Phone" placeholder="+234 ..." value={form.phone} onChangeText={(phone) => set({ phone })} keyboardType="phone-pad" />
          </SectionCard>

          <SectionCard title="Location" style={styles.card}>
            <SelectField label="State of practice" placeholder="Select state" value={form.state} options={NIGERIAN_STATES} onChange={(state) => set({ state })} />
            <TextInputField label="City" placeholder="e.g. Lagos" value={form.city ?? ''} onChangeText={(city) => set({ city })} />
            <TextInputField label="Address" placeholder="Street address" value={form.address ?? ''} onChangeText={(address) => set({ address })} />
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
  btn:     { marginTop: Spacing.sm },
});
