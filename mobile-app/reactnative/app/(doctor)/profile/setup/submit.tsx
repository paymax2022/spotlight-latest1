import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, FileCheck2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow } from '@/features/doctor/components';
import { useProfileDraft, useSubmitProfileVerification } from '@/features/doctor/hooks';

export default function SubmitVerificationScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const submit = useSubmitProfileVerification();
  const [error, setError] = useState<string>();

  const handleSubmit = async () => {
    if (!draft) return;
    setError(undefined);
    try {
      await submit.mutateAsync({ draftId: draft.id });
      router.replace('/(doctor)/profile/verification/submitted');
    } catch {
      setError('Submission failed. Please try again.');
    }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Submit for verification" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Submit for verification" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Submit for verification" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <View style={styles.introIcon}>
            <ShieldCheck size={24} color={Colors.primary} strokeWidth={2} />
          </View>
          <Text style={styles.introTitle}>Ready to submit</Text>
          <Text style={styles.introSub}>We will verify your credentials against the MDCN register. This usually takes 24–48 hours.</Text>
        </View>

        <SectionCard title="Submission summary" style={styles.card}>
          <InfoRow label="Licence" value={draft.licence.licenceNumber} />
          <InfoRow label="Documents" value={`${draft.documents.filter((d) => d.file).length} uploaded`} />
          <InfoRow label="Certificates" value={`${draft.certificates.length} uploaded`} />
          <InfoRow label="Completed steps" value={`${draft.completedSteps.length}`} />
        </SectionCard>

        <SectionCard title="What happens next" style={styles.card}>
          <View style={styles.point}>
            <FileCheck2 size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.pointText}>Your documents are reviewed by our verification team.</Text>
          </View>
          <View style={styles.point}>
            <FileCheck2 size={18} color={Colors.teal} strokeWidth={2} />
            <Text style={styles.pointText}>You will be notified once a decision is made.</Text>
          </View>
        </SectionCard>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <PrimaryButton label="Submit for verification" onPress={handleSubmit} loading={submit.isPending} style={styles.btn} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  intro:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  introIcon:  { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  introTitle: { ...Typography.titleLg, color: Colors.onSurface },
  introSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:       { marginBottom: Spacing.md },
  point:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  pointText:  { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  error:      { ...Typography.labelMd, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  btn:        { marginTop: Spacing.sm },
});
