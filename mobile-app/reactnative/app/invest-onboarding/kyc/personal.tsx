import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StepHeader from '@/features/investonboarding/components/StepHeader';
import { kycDraft } from '@/features/investonboarding/utils/onboardingDraft';
import { validatePersonal, hasNoErrors } from '@/features/investonboarding/utils/onboarding.utils';
import { KYC_PRIVACY_NOTE } from '@/features/investonboarding/constants/onboarding.constants';
import type { KycPersonal } from '@/features/investonboarding/types/onboarding.types';

export default function KycPersonalScreen() {
  const [form, setForm] = useState<KycPersonal>({ ...kycDraft.current.personal });
  const [errors, setErrors] = useState<Partial<Record<keyof KycPersonal, string>>>({});

  const set = (key: keyof KycPersonal, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onContinue = () => {
    const found = validatePersonal(form);
    setErrors(found);
    if (!hasNoErrors(found)) return;
    kycDraft.current.personal = form;
    router.push('/invest-onboarding/kyc/identity');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your details" />
      <StepHeader step={1} total={4} label="Personal" />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>Enter your details exactly as they appear on your government ID.</Text>

          <TextInputField label="First name" placeholder="e.g. Ada" value={form.firstName} onChangeText={(t) => set('firstName', t)} autoCapitalize="words" error={errors.firstName} />
          <TextInputField label="Last name" placeholder="e.g. Okeke" value={form.lastName} onChangeText={(t) => set('lastName', t)} autoCapitalize="words" error={errors.lastName} />
          <TextInputField label="Date of birth" placeholder="YYYY-MM-DD" value={form.dob} onChangeText={(t) => set('dob', t)} keyboardType="numbers-and-punctuation" error={errors.dob} />
          <TextInputField label="BVN" placeholder="11-digit Bank Verification Number" value={form.bvn} onChangeText={(t) => set('bvn', t.replace(/\D/g, '').slice(0, 11))} keyboardType="number-pad" maxLength={11} error={errors.bvn} />
          <TextInputField label="NIN" placeholder="11-digit National ID Number" value={form.nin} onChangeText={(t) => set('nin', t.replace(/\D/g, '').slice(0, 11))} keyboardType="number-pad" maxLength={11} error={errors.nin} />

          <Text style={styles.privacy}>{KYC_PRIVACY_NOTE}</Text>
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Continue" onPress={onContinue} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin, paddingTop: 0 },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  privacy: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18, marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
