// PRIVACY: Assisted Mode B verification. Serves both the "rejected" resubmit and
// the "more information needed" (needs_info) re-submission flow. It shows the
// doctor only their own document slots + guidance. It must NEVER render MDCN/
// register data, reviewer identity, internal reviewer notes, or matched-field
// detail — Paymax verifies out-of-band and the doctor never sees the MDCN portal.
import React, { useState } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, UploadField } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import { useDocumentSlots, useUploadDocument, useSubmitProfileVerification, useProfileDraft } from '@/features/doctor/hooks';
import { PROFILE_DOC_TYPE_LABELS } from '@/features/doctor/constants';
import type { ProfileDocType } from '@/types/doctor.profile';

export default function ResubmitVerificationScreen() {
  const { data: slots, isLoading, isError, refetch } = useDocumentSlots();
  const { data: draft } = useProfileDraft();
  const upload = useUploadDocument();
  const submit = useSubmitProfileVerification();

  // Per-slot upload state keyed by doc type.
  const [states, setStates] = useState<Record<string, UploadFieldState>>({});
  const [files, setFiles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  const setState = (type: string, s: UploadFieldState) => setStates((p) => ({ ...p, [type]: s }));

  const pick = (type: ProfileDocType) => {
    const fileName = `${type}-${Date.now()}.pdf`;
    setFiles((p) => ({ ...p, [type]: fileName }));
    setState(type, 'selected');
  };

  const doUpload = async (type: ProfileDocType) => {
    const fileName = files[type];
    if (!fileName) return;
    setState(type, 'uploading');
    try {
      await upload.mutateAsync({ type, uri: `file:///picked/${fileName}`, fileName, mimeType: 'application/pdf' });
      setState(type, 'uploaded');
    } catch {
      setState(type, 'error');
    }
  };

  const anyUploaded = Object.values(states).some((s) => s === 'uploaded');

  const handleResubmit = async () => {
    setError(undefined);
    try {
      await submit.mutateAsync({ draftId: draft?.id ?? 'draft-1' });
      router.replace('/(doctor)/profile/verification/submitted');
    } catch {
      setError('Resubmission failed. Please try again.');
    }
  };

  if (isLoading && !slots) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Resubmit documents" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !slots) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Resubmit documents" />
        <StateView variant="error" message="We could not load your documents." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Resubmit documents" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <SectionCard title="Re-upload documents" style={styles.card}>
          <Text style={styles.hint}>Re-upload any documents flagged during review, then resubmit for verification.</Text>
          {slots.map((slot) => {
            const st = states[slot.type] ?? (slot.file ? 'uploaded' : 'empty');
            return (
              <UploadField
                key={slot.type}
                label={PROFILE_DOC_TYPE_LABELS[slot.type] ?? slot.label}
                required={slot.required}
                state={st}
                fileName={files[slot.type] ?? slot.file?.fileName}
                onPick={() => pick(slot.type)}
                onUpload={() => doUpload(slot.type)}
                onRetry={() => doUpload(slot.type)}
              />
            );
          })}
        </SectionCard>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <PrimaryButton label="Resubmit for verification" onPress={handleResubmit} loading={submit.isPending} disabled={!anyUploaded} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:    { marginBottom: Spacing.md },
  hint:    { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  error:   { ...Typography.labelMd, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  btn:     { marginTop: Spacing.sm },
});
