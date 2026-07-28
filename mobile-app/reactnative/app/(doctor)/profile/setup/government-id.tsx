import React, { useState } from 'react';
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
import { useDocumentSlots, useUploadDocument } from '@/features/doctor/hooks';
import { ID_TYPE_OPTIONS } from '@/features/doctor/constants';

export default function GovernmentIdScreen() {
  const { data: slots, isLoading, isError, refetch } = useDocumentSlots();
  const upload = useUploadDocument();

  const slot = slots?.find((s) => s.type === 'government_id');
  const [idType, setIdType] = useState<string | undefined>();
  const [state, setState] = useState<UploadFieldState>(slot?.file ? 'uploaded' : 'empty');
  const [fileName, setFileName] = useState<string | undefined>(slot?.file?.fileName);
  const [error, setError] = useState<string>();

  const pick = () => {
    setError(undefined);
    setFileName(`government-id-${Date.now()}.jpg`);
    setState('selected');
  };

  const doUpload = async () => {
    if (!fileName) return;
    setState('uploading');
    try {
      await upload.mutateAsync({ type: 'government_id', uri: `file:///picked/${fileName}`, fileName, mimeType: 'image/jpeg' });
      setState('uploaded');
    } catch {
      setState('error');
      setError('Upload failed. Please try again.');
    }
  };

  const canContinue = (state === 'uploaded' || !!slot?.file) && !!idType;

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
        <WizardProgress current={10} total={19} label="Government ID" />

        <SectionCard title="Identity document" style={styles.card}>
          <Text style={styles.hint}>Select your ID type and upload a clear photo of it.</Text>
          <SelectField
            label="ID type"
            placeholder="Select ID type"
            value={ID_TYPE_OPTIONS.find((o) => o.value === idType)?.label}
            options={ID_TYPE_OPTIONS.map((o) => o.label)}
            onChange={(label) => setIdType(ID_TYPE_OPTIONS.find((o) => o.label === label)?.value)}
            searchable={false}
          />
          <UploadField
            label="Government ID"
            required
            state={state}
            fileName={fileName}
            hint="JPG, PNG or PDF"
            errorText={error}
            onPick={pick}
            onUpload={doUpload}
            onRetry={doUpload}
          />
        </SectionCard>

        <PrimaryButton label="Continue" onPress={() => router.push('/(doctor)/profile/setup/certificates')} disabled={!canContinue} style={styles.btn} />
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
