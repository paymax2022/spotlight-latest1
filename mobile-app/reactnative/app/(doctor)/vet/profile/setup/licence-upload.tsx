import React, { useState } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, UploadField } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import { useVetProfileDraft, useVetDocumentSlots, useSaveVetProfileDraft } from '@/features/doctor/hooks';
import type { UploadedFile } from '@/types/doctor.batch1';

export default function VetLicenceUploadScreen() {
  const { data: draft } = useVetProfileDraft();
  const { data: slots, isLoading, isError, refetch } = useVetDocumentSlots();
  const save = useSaveVetProfileDraft();

  const slot = slots?.find((s) => s.type === 'medical_license') ?? slots?.[0];
  const existing = draft?.licence.licenceFile ?? slot?.file;
  const [state, setState] = useState<UploadFieldState>(existing ? 'uploaded' : 'empty');
  const [fileName, setFileName] = useState<string | undefined>(existing?.fileName);
  const [uploadErr, setUploadErr] = useState<string>();

  const pick = () => {
    setUploadErr(undefined);
    setFileName(`vet-licence-${Date.now()}.pdf`);
    setState('selected');
  };

  // Phase A stubs the picker: mark uploaded locally; the file persists on Continue.
  const doUpload = () => setState('uploaded');

  const canContinue = state === 'uploaded';

  const handleNext = async () => {
    if (!draft || !fileName) return;
    const file: UploadedFile = {
      id: `vet-lic-${Date.now()}`,
      uri: `file:///picked/${fileName}`,
      fileName,
      mimeType: 'application/pdf',
      uploadedAt: new Date().toISOString(),
    };
    try {
      await save.mutateAsync({
        draft: {
          licence: { ...draft.licence, licenceFile: file },
          completedSteps: [...new Set([...draft.completedSteps, 'licence_upload' as const])],
        },
      });
      router.push('/(doctor)/vet/profile/setup/certificates');
    } catch {
      setUploadErr('Could not save the licence. Please try again.');
    }
  };

  if (isLoading && !slots) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Upload licence" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !slots) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Upload licence" />
        <StateView variant="error" message="We could not load your documents." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Upload licence" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={5} total={10} label="Upload veterinary licence" />

        <SectionCard title="Veterinary licence document" style={styles.card}>
          <Text style={styles.hint}>Upload a clear scan or photo of your current veterinary licence.</Text>
          <UploadField
            label="Veterinary licence"
            required
            state={state}
            fileName={fileName}
            hint="PDF, JPG or PNG"
            errorText={uploadErr}
            onPick={pick}
            onUpload={doUpload}
            onRetry={doUpload}
          />
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
  btn:     { marginTop: Spacing.sm },
});
