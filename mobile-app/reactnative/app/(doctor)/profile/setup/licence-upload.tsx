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
import { useDocumentSlots, useUploadDocument } from '@/features/doctor/hooks';

export default function LicenceUploadScreen() {
  const { data: slots, isLoading, isError, refetch } = useDocumentSlots();
  const upload = useUploadDocument();

  const slot = slots?.find((s) => s.type === 'medical_license');
  const [state, setState] = useState<UploadFieldState>(slot?.file ? 'uploaded' : 'empty');
  const [fileName, setFileName] = useState<string | undefined>(slot?.file?.fileName);
  const [error, setError] = useState<string>();

  const pick = () => {
    setError(undefined);
    setFileName(`medical-license-${Date.now()}.pdf`);
    setState('selected');
  };

  const doUpload = async () => {
    if (!fileName) return;
    setState('uploading');
    try {
      await upload.mutateAsync({ type: 'medical_license', uri: `file:///picked/${fileName}`, fileName, mimeType: 'application/pdf' });
      setState('uploaded');
    } catch {
      setState('error');
      setError('Upload failed. Please try again.');
    }
  };

  const canContinue = state === 'uploaded';

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
        <WizardProgress current={9} total={19} label="Upload medical licence" />

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

        <PrimaryButton label="Continue" onPress={() => router.push('/(doctor)/profile/setup/government-id')} disabled={!canContinue} style={styles.btn} />
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
