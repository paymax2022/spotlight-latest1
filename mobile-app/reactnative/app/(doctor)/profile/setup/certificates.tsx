import React, { useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, UploadField, EditableListCard } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import { useProfileDraft, useUploadDocument, useSaveProfileDraft } from '@/features/doctor/hooks';
import type { UploadedFile } from '@/types/doctor.profile';

export default function CertificatesScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const upload = useUploadDocument();
  const save = useSaveProfileDraft();

  const [list, setList] = useState<UploadedFile[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [state, setState] = useState<UploadFieldState>('empty');
  const [fileName, setFileName] = useState<string | undefined>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (draft && list === null) setList(draft.certificates);
  }, [draft, list]);

  const certs = list ?? [];

  const pick = () => {
    setError(undefined);
    setFileName(`certificate-${Date.now()}.pdf`);
    setState('selected');
  };

  const doUpload = async () => {
    if (!fileName) return;
    setState('uploading');
    try {
      const res = await upload.mutateAsync({ type: 'certificate', uri: `file:///picked/${fileName}`, fileName, mimeType: 'application/pdf' });
      setList((prev) => [...(prev ?? []), res.file]);
      setState('empty');
      setFileName(undefined);
      setAdding(false);
    } catch {
      setState('error');
      setError('Upload failed. Please try again.');
    }
  };

  const removeCert = (id: string) => setList((prev) => (prev ?? []).filter((c) => c.id !== id));

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { certificates: certs, completedSteps: [...new Set([...draft.completedSteps, 'certificates' as const])] } });
      router.push('/(doctor)/profile/setup/association');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Certificates" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || list === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Certificates" />
        <StateView variant="error" message="We could not load your certificates." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Certificates" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <WizardProgress current={11} total={19} label="Certificates" />

        <SectionCard title="Professional certificates" style={styles.card}>
          <Text style={styles.hint}>Add any additional certificates or fellowships (optional).</Text>

          {certs.length === 0 && !adding ? (
            <Text style={styles.empty}>No certificates added yet.</Text>
          ) : (
            certs.map((c) => (
              <EditableListCard key={c.id} title={c.fileName} meta={`Uploaded ${new Date(c.uploadedAt).toLocaleDateString('en-NG')}`} onRemove={() => removeCert(c.id)} />
            ))
          )}

          {adding && (
            <View style={styles.uploadWrap}>
              <UploadField label="Certificate" state={state} fileName={fileName} errorText={error} onPick={pick} onUpload={doUpload} onRetry={doUpload} />
            </View>
          )}

          {!adding && (
            <Pressable style={styles.addBtn} onPress={() => { setAdding(true); setState('empty'); }} accessibilityRole="button" accessibilityLabel="Add certificate">
              <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
              <Text style={styles.addText}>Add a certificate</Text>
            </Pressable>
          )}
        </SectionCard>

        <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:       { marginBottom: Spacing.md },
  hint:       { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  empty:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  uploadWrap: { marginTop: Spacing.xs },
  addBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed, marginTop: Spacing.xs },
  addText:    { ...Typography.labelMd, color: Colors.primary },
  btn:        { marginTop: Spacing.sm },
});
