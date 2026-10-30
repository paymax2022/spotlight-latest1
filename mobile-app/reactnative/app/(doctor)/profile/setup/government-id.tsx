import React, { useState } from 'react';
import { Text, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress } from '@/features/doctor/components';
import { useDocumentSlots, useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';
import { ID_TYPE_OPTIONS } from '@/features/doctor/constants';
import { checkIdNumber, createSession, postConsent } from '@/features/kycverify/api';
import { CONSENT_VERSION } from '@/features/kycverify/constants';
import { cleanProviderReason } from '@/features/kycverify/providerReason';
import { ID_FORMATS, validateIdNumber } from '@/features/kycverify/idFormats';
import IdNumberField from '@/features/kycverify/components/IdNumberField';
import DojahRequirement from '@/features/kycverify/components/DojahRequirement';
import type { IdType, VerificationCheck } from '@/features/kycverify/types';

// The doctor wizard keys its options by its own slugs; the KYC gateway and
// Dojah's routes are keyed by IdType.
const ID_TYPE_BY_OPTION: Record<string, IdType> = {
  nin: 'NIN',
  drivers: 'DRIVERS_LICENSE',
  passport: 'PASSPORT',
  voters_card: 'VOTERS_CARD',
};

export default function GovernmentIdScreen() {
  const { data: slots, isLoading, isError, refetch } = useDocumentSlots();
  const { data: draft } = useProfileDraft();
  const save = useSaveProfileDraft();

  const [idType, setIdType] = useState<string | undefined>();
  const [idNumber, setIdNumber] = useState<string>('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string>();
  // The PASSED check returned by the provider lookup: its matched name/DOB are
  // DISPLAYED for the user to affirm, and Continue is that affirmation.
  const [verified, setVerified] = useState<VerificationCheck | null>(null);

  const idTypeKey = idType ? ID_TYPE_BY_OPTION[idType] : undefined;
  const validation = idTypeKey ? validateIdNumber(idTypeKey, idNumber) : { ok: false, normalized: idNumber, error: undefined };

  const handleVerify = async () => {
    if (!idTypeKey || !validation.ok) {
      if (idTypeKey) setError(validation.error ?? 'Enter your ID number first.');
      return;
    }

    setError(undefined);
    setVerified(null);
    setVerifying(true);
    try {
      // 1. Create a KYC session for Tier 1
      const session = await createSession(1);

      // 2. Record mandatory NDPA/CBN consent before running checks
      await postConsent('kyc-data-processing', CONSENT_VERSION);

      // 3. Run the ID number check against that session
      const check = await checkIdNumber({
        sessionId: session.id,
        idType: idTypeKey,
        idNumber: validation.normalized,
      });

      if (check.status === 'PASSED') {
        setVerified(check);
      } else if (check.status === 'PENDING' || check.status === 'REVIEW') {
        setError('Verification is still processing. Please try again in a moment.');
      } else {
        setError(cleanProviderReason(check.reason) ?? 'We could not match this ID number. Check the number and try again.');
      }
    } catch (e: any) {
      setError(e.message || 'Verification failed. Please check your ID number.');
    } finally {
      setVerifying(false);
    }
  };

  const canContinue = verified?.status === 'PASSED';

  // Continue IS the affirmation — record the step in the draft so the hub stops
  // re-prompting it (the KYC attempt itself lives in the finance/kyc tables).
  const handleNext = async () => {
    if (draft) {
      // Carry the government-verified DOB into the profile when the doctor
      // never picked one on the personal step.
      const dobPatch = verified?.matchedDob && !draft.personalInfo.dateOfBirth
        ? { personalInfo: { ...draft.personalInfo, dateOfBirth: verified.matchedDob } }
        : {};
      try {
        await save.mutateAsync({ draft: { ...dobPatch, completedSteps: [...new Set([...draft.completedSteps, 'government_id' as const])] } });
      } catch { /* non-blocking */ }
    }
    router.push('/(doctor)/profile/setup/certificates');
  };

  if (isLoading && !slots) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Government ID" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !slots) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Government ID" />
        <StateView variant="error" message="We could not load your documents." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Government ID" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={10} total={18} label="Government ID" />

        <SectionCard title="Identity verification" style={styles.card}>
          <Text style={styles.hint}>We check your ID number against government records and show you the details registered to it. Continue confirms those details are yours.</Text>
          <SelectField
            label="ID type"
            placeholder="Select ID type"
            value={ID_TYPE_OPTIONS.find((o) => o.value === idType)?.label}
            options={ID_TYPE_OPTIONS.map((o) => o.label)}
            onChange={(label) => { setIdType(ID_TYPE_OPTIONS.find((o) => o.label === label)?.value); setIdNumber(''); setVerified(null); setError(undefined); }}
            searchable={false}
          />
          {idTypeKey ? (
            <>
              <IdNumberField
                idType={idTypeKey}
                value={idNumber}
                onChangeText={(text) => { setIdNumber(text); setVerified(null); setError(undefined); }}
              />
              <DojahRequirement idType={idTypeKey} idNumber={validation.normalized} />
            </>
          ) : null}
          {error && <Text style={styles.error}>{error}</Text>}
          {verified?.status === 'PASSED' ? (
            <View style={styles.matchCard}>
              {verified.matchedName ? (
                <View style={styles.matchRow}>
                  <Text style={styles.matchKey}>Registered name</Text>
                  <Text style={styles.matchVal}>{verified.matchedName}</Text>
                </View>
              ) : null}
              {verified.matchedDob ? (
                <View style={styles.matchRow}>
                  <Text style={styles.matchKey}>Date of birth</Text>
                  <Text style={styles.matchVal}>{verified.matchedDob}</Text>
                </View>
              ) : null}
              <Text style={styles.matchHint}>
                If these are your details, tap Continue below to confirm them.
              </Text>
            </View>
          ) : (
            <PrimaryButton
              label={verifying ? 'Verifying...' : 'Verify'}
              onPress={handleVerify}
              loading={verifying}
              disabled={!validation.ok}
              variant="secondary"
              style={styles.verifyBtn}
            />
          )}
        </SectionCard>

        <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} disabled={!canContinue} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:    { marginBottom: Spacing.md },
  hint:    { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  error:   { ...Typography.labelSm, color: Colors.error, marginBottom: Spacing.sm },
  verifyBtn: { marginTop: Spacing.sm },
  btn:     { marginTop: Spacing.sm },
  matchCard: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm, marginTop: Spacing.sm,
  },
  matchRow:  { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  matchKey:  { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  matchVal:  { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const, flexShrink: 1, textAlign: 'right' },
  matchHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
