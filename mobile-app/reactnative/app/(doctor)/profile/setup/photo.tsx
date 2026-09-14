import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, UploadField } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import { useProfileDraft, useUploadProfilePhoto, useSaveProfileDraft } from '@/features/doctor/hooks';
import { pickFileForField } from '@/features/registration/utils/filePicker';
import type { PickedUpload } from '@/features/registration/types/registration.types';

export default function ProfilePhotoScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const upload = useUploadProfilePhoto();
  const save = useSaveProfileDraft();

  const [state, setState] = useState<UploadFieldState>('empty');
  const [fileName, setFileName] = useState<string | undefined>();
  const [picked, setPicked] = useState<PickedUpload>();
  const [error, setError] = useState<string>();

  const pick = async () => {
    setError(undefined);
    const file = await pickFileForField('.jpg,.jpeg,.png');
    if (!file) return;
    setPicked(file);
    setFileName(file.name);
    setState('selected');
  };

  const doUpload = async () => {
    if (!picked) return;
    setState('uploading');
    try {
      await upload.mutateAsync({ uri: picked.uri, fileName: picked.name, mimeType: picked.mimeType });
      setState('uploaded');
    } catch {
      setState('error');
      setError('Upload failed. Please try again.');
    }
  };

  const alreadyHas = !!draft?.photo;
  const canContinue = state === 'uploaded' || alreadyHas;

  const handleNext = async () => {
    if (draft) {
      try {
        await save.mutateAsync({ draft: { completedSteps: [...new Set([...draft.completedSteps, 'profile_photo' as const])] } });
      } catch { /* non-blocking */ }
    }
    router.push('/(doctor)/profile/setup/bio');
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Profile photo" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Profile photo" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Profile photo" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={2} total={19} label="Profile photo" />

        <SectionCard title="Upload a profile photo" style={styles.card}>
          <Text style={styles.hint}>Use a clear, front-facing photo. This is shown to patients on your profile.</Text>
          <UploadField
            label="Profile photo"
            required
            state={state}
            fileName={fileName ?? draft.photo?.fileName}
            hint="JPG or PNG, square crop recommended"
            errorText={error}
            onPick={pick}
            onUpload={doUpload}
            onRetry={doUpload}
          />
          {alreadyHas && state === 'empty' && <Text style={styles.note}>A photo is already on file: {draft.photo?.fileName}</Text>}
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
  note:    { ...Typography.caption, color: Colors.teal },
  btn:     { marginTop: Spacing.sm },
});
