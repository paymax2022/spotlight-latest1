import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, UploadField } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import { useDocumentSlots, useUploadDocument, useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';
import { pickFileForField } from '@/features/registration/utils/filePicker';
import type { PickedUpload } from '@/features/registration/types/registration.types';
import type { UploadedFile } from '@/types/doctor.profile';

export default function LicenceUploadScreen() {
  const { data: slots, isLoading, isError, refetch } = useDocumentSlots();
  const { data: draft } = useProfileDraft();
  const save = useSaveProfileDraft();
  const upload = useUploadDocument();

  const slot = slots?.find((s) => s.type === 'medical_license');
  const [state, setState] = useState<UploadFieldState>(slot?.file ? 'uploaded' : 'empty');
  const [fileName, setFileName] = useState<string | undefined>(slot?.file?.fileName);
  const [picked, setPicked] = useState<PickedUpload>();
  const [uploaded, setUploaded] = useState<UploadedFile | undefined>(slot?.file);
  const [error, setError] = useState<string>();

  // Slots load async, so the useState seed above usually sees undefined —
  // adopt the server-side file once the query resolves.
  useEffect(() => {
    const f = slot?.file;
    if (!f) return;
    setUploaded((prev) => prev ?? f);
    setState((prev) => (prev === 'empty' ? 'uploaded' : prev));
    setFileName((prev) => prev ?? f.fileName);
  }, [slot]);

  const pick = async () => {
    setError(undefined);
    const file = await pickFileForField('.pdf,.jpg,.jpeg,.png');
    if (!file) return;
    setPicked(file);
    setFileName(file.name);
    setState('selected');
  };

  const doUpload = async () => {
    if (!picked) return;
    setState('uploading');
    try {
      const res = await upload.mutateAsync({ type: 'medical_license', uri: picked.uri, fileName: picked.name, mimeType: picked.mimeType });
      setUploaded(res.file);
      setState('uploaded');
    } catch {
      setState('error');
      setError('Upload failed. Please try again.');
    }
  };

  const canContinue = state === 'uploaded';

  // The documents table already holds the file; mirror it into the draft so the
  // preview (which reads licence.licenceFile) and the hub step checklist agree.
  const handleNext = async () => {
    if (draft && uploaded) {
      try {
        await save.mutateAsync({ draft: { licence: { ...draft.licence, licenceFile: uploaded }, completedSteps: [...new Set([...draft.completedSteps, 'licence_upload' as const])] } });
      } catch { /* non-blocking */ }
    }
    router.push('/(doctor)/profile/setup/government-id');
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
        <WizardProgress current={9} total={18} label="Upload medical licence" />

        <SectionCard title="Medical licence document" style={styles.card}>
          <Text style={styles.hint}>Upload a clear scan or photo of your current MDCN licence.</Text>
          <UploadField
            label="Medical licence"
            required
            state={state}
            fileName={fileName}
            hint="PDF, JPG or PNG"
            errorText={error}
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
