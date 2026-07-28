import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, UploadField } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import { useVetProfileDraft, useRenewVetLicence } from '@/features/doctor/hooks';

export default function VetLicenceRenewScreen() {
  const { data: draft, isLoading, isError, refetch } = useVetProfileDraft();
  const renew = useRenewVetLicence();

  const [licenceNumber, setLicenceNumber] = useState('');
  const [newExpiresAt, setNewExpiresAt] = useState<string | undefined>();
  const [state, setState] = useState<UploadFieldState>('empty');
  const [fileName, setFileName] = useState<string | undefined>();
  const [uploadErr, setUploadErr] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (draft && !licenceNumber) setLicenceNumber(draft.licence.licenceNumber);
  }, [draft, licenceNumber]);

  const pick = () => {
    setUploadErr(undefined);
    setFileName(`renewed-vet-licence-${Date.now()}.pdf`);
    setState('selected');
  };

  const markUploaded = () => setState('uploaded');

  const canSubmit = licenceNumber.trim().length > 0 && !!newExpiresAt && state === 'uploaded' && !!fileName;

  const handleSubmit = async () => {
    if (!newExpiresAt || !fileName) return;
    setError(undefined);
    try {
      await renew.mutateAsync({ licenceNumber: licenceNumber.trim(), newExpiresAt, uri: `file:///picked/${fileName}`, fileName, mimeType: 'application/pdf' });
      router.replace('/(doctor)/vet/profile/verification');
    } catch {
      setError('Renewal submission failed. Please try again.');
    }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Renew licence" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Renew licence" />
        <StateView variant="error" message="We could not load your licence." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Renew licence" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionCard title="Renewed licence details" style={styles.card}>
            <Text style={styles.hint}>Upload your renewed veterinary licence. It will be re-verified.</Text>
            <TextInputField label="Licence number" placeholder="e.g. VCN/R/0184" value={licenceNumber} onChangeText={setLicenceNumber} autoCapitalize="characters" />
            <DatePickerField label="New expiry date" value={newExpiresAt} onChange={setNewExpiresAt} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 20} />
          </SectionCard>

          <SectionCard title="Renewed licence document" style={styles.card}>
            <UploadField
              label="Renewed licence"
              required
              state={state}
              fileName={fileName}
              hint="PDF, JPG or PNG"
              errorText={uploadErr}
              onPick={pick}
              onUpload={markUploaded}
              onRetry={markUploaded}
            />
          </SectionCard>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <PrimaryButton label="Submit renewal" onPress={handleSubmit} loading={renew.isPending} disabled={!canSubmit} style={styles.btn} />
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
  error:   { ...Typography.labelMd, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  btn:     { marginTop: Spacing.sm },
});
