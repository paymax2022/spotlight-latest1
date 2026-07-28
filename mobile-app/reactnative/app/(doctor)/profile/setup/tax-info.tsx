import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, ToggleRow } from '@/features/doctor/components';
import { useProfileDraft, useSaveTaxInfo } from '@/features/doctor/hooks';
import type { TaxInfo } from '@/types/doctor.profile';

const EMPTY: TaxInfo = { hasTin: false, tin: '', vatRegistered: false, vatNumber: '', businessName: '' };

export default function TaxInfoScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveTaxInfo();
  const [form, setForm] = useState<TaxInfo | null>(null);

  useEffect(() => {
    if (draft && !form) setForm(draft.taxInfo ?? EMPTY);
  }, [draft, form]);

  const set = (patch: Partial<TaxInfo>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const handleNext = async () => {
    if (!form) return;
    try {
      await save.mutateAsync({ taxInfo: form });
      router.push('/(doctor)/profile/setup/preview');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Tax information" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || !form) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Tax information" />
        <StateView variant="error" message="We could not load your tax info." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Tax information" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={19} total={19} label="Tax / VAT information" />

          <SectionCard title="Tax identification" style={styles.card}>
            <Text style={styles.hint}>Provide your tax details for payout compliance (optional).</Text>
            <ToggleRow label="I have a Tax Identification Number (TIN)" value={form.hasTin} onValueChange={(hasTin) => set({ hasTin })} />
            {form.hasTin && <TextInputField label="TIN" placeholder="e.g. 1234567-0001" value={form.tin ?? ''} onChangeText={(tin) => set({ tin })} />}
          </SectionCard>

          <SectionCard title="VAT" style={styles.card}>
            <ToggleRow label="Registered for VAT" value={form.vatRegistered} onValueChange={(vatRegistered) => set({ vatRegistered })} />
            {form.vatRegistered && <TextInputField label="VAT number" placeholder="VAT registration number" value={form.vatNumber ?? ''} onChangeText={(vatNumber) => set({ vatNumber })} />}
          </SectionCard>

          <SectionCard title="Business" style={styles.card}>
            <TextInputField label="Business / practice name (optional)" placeholder="e.g. Dr. Amaka Obi Family Practice" value={form.businessName ?? ''} onChangeText={(businessName) => set({ businessName })} />
          </SectionCard>

          <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} style={styles.btn} />
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
