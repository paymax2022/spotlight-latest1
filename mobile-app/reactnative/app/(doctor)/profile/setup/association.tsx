import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, UploadField } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import { useProfileDraft, useUploadDocument, useSaveProfileDraft } from '@/features/doctor/hooks';
import { ASSOCIATION_OPTIONS } from '@/features/doctor/constants';
import type { UploadedFile } from '@/types/doctor.profile';

export default function AssociationScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const upload = useUploadDocument();
  const save = useSaveProfileDraft();

  const [association, setAssociation] = useState<string | undefined>();
  const [file, setFile] = useState<UploadedFile | undefined>();
  const [state, setState] = useState<UploadFieldState>('empty');
  const [fileName, setFileName] = useState<string | undefined>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (draft && !file && draft.associationMembership) {
      setFile(draft.associationMembership);
      setFileName(draft.associationMembership.fileName);
      setState('uploaded');
    }
  }, [draft, file]);

  const pick = () => {
    setError(undefined);
    setFileName(`association-${Date.now()}.pdf`);
    setState('selected');
  };

  const doUpload = async () => {
    if (!fileName) return;
    setState('uploading');
    try {
      const res = await upload.mutateAsync({ type: 'association_membership', uri: `file:///picked/${fileName}`, fileName, mimeType: 'application/pdf' });
      setFile(res.file);
      setState('uploaded');
    } catch {
      setState('error');
      setError('Upload failed. Please try again.');
    }
  };

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { associationMembership: file, completedSteps: [...new Set([...draft.completedSteps, 'association' as const])] } });
      router.push('/(doctor)/profile/setup/affiliations');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Association" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Association" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Association" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={12} total={19} label="Association membership" />

        <SectionCard title="Professional association" style={styles.card}>
          <Text style={styles.hint}>Add proof of membership of a professional association (optional).</Text>
          <SelectField label="Association" placeholder="Select association" value={association} options={ASSOCIATION_OPTIONS} onChange={setAssociation} />
          <UploadField
            label="Membership proof"
            state={state}
            fileName={fileName}
            hint="PDF, JPG or PNG"
            errorText={error}
            onPick={pick}
            onUpload={doUpload}
            onRetry={doUpload}
          />
        </SectionCard>

        <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} style={styles.btn} />
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
