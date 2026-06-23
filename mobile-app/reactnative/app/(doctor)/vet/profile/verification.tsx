import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Clock, CheckCircle2, XCircle, FileCheck2 } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView } from '@/features/doctor/components';
import { useVetProfileDraft, useVetVerification, usePublishVetProfile } from '@/features/doctor/hooks';
import type { VerificationStatus } from '@/types/doctor.batch1';

const STATUS_CONFIG: Record<VerificationStatus, { icon: LucideIcon; color: string; bg: string; title: string; sub: string }> = {
  unsubmitted: { icon: FileCheck2,   color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow, title: 'Not submitted',           sub: 'Submit your vet profile to begin verification.' },
  pending:     { icon: Clock,        color: Colors.secondary,        bg: Colors.iconBgBlue,          title: 'Verification submitted',  sub: 'Your documents are under review. This usually takes 24–48 hours.' },
  approved:    { icon: CheckCircle2, color: Colors.teal,             bg: Colors.iconBgTeal,          title: 'Verified',                sub: 'You are verified. Publish your vet profile to start accepting animal consults.' },
  rejected:    { icon: XCircle,      color: Colors.error,            bg: Colors.errorContainer,      title: 'Verification rejected',   sub: 'Please review the reason below and resubmit your profile.' },
};

export default function VetVerificationScreen() {
  const { data: draft } = useVetProfileDraft();
  const { data: submission, isLoading, isError, refetch } = useVetVerification();
  const publish = usePublishVetProfile();
  const [error, setError] = useState<string>();

  const handlePublish = async () => {
    if (!draft) return;
    setError(undefined);
    try {
      await publish.mutateAsync({ draftId: draft.id });
      router.replace('/(doctor)/profile/published');
    } catch {
      setError('Could not publish your profile. Please try again.');
    }
  };

  if (isLoading && !submission) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Verification status" />
        <StateView variant="loading" label="Checking your status" />
      </SafeAreaView>
    );
  }

  if (isError || !submission) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Verification status" />
        <StateView variant="error" message="We could not load your verification status." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const cfg = STATUS_CONFIG[submission.status];
  const Icon = cfg.icon;
  const decision = submission.decision;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Verification status" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: cfg.bg }]}>
            <Icon size={36} color={cfg.color} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>{cfg.title}</Text>
          <Text style={styles.heroSub}>{cfg.sub}</Text>
        </View>

        {submission.status === 'rejected' && (decision?.notes || submission.notes) && (
          <SectionCard title="Reason" style={styles.card}>
            <Text style={styles.reason}>{decision?.notes ?? submission.notes}</Text>
          </SectionCard>
        )}

        <SectionCard title="Submission details" style={styles.card}>
          {submission.submittedAt && <InfoRow label="Submitted" value={new Date(submission.submittedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />}
          {submission.reviewedAt && <InfoRow label="Reviewed" value={new Date(submission.reviewedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />}
          <InfoRow label="Documents" value={`${submission.documents.length} uploaded`} />
        </SectionCard>

        {submission.documents.length > 0 && (
          <SectionCard title="Documents" style={styles.card}>
            {submission.documents.map((doc, i) => (
              <View key={doc.type} style={[styles.docRow, i > 0 && styles.docBorder]}>
                <FileCheck2 size={18} color={Colors.teal} strokeWidth={2} />
                <Text style={styles.docLabel} numberOfLines={1}>{doc.label}</Text>
                <Text style={styles.docFile} numberOfLines={1}>{doc.file?.fileName ?? (doc.required ? 'Required' : 'Optional')}</Text>
              </View>
            ))}
          </SectionCard>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {submission.status === 'approved' ? (
          <PrimaryButton label="Publish my profile" onPress={handlePublish} loading={publish.isPending} style={styles.btn} />
        ) : submission.status === 'rejected' ? (
          <PrimaryButton label="Review & resubmit" onPress={() => router.push('/(doctor)/vet/profile/setup')} style={styles.btn} />
        ) : (
          <PrimaryButton label="Refresh status" onPress={() => refetch()} variant="secondary" style={styles.btn} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg, paddingHorizontal: Spacing.md },
  heroIcon:  { width: 80, height: 80, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  heroSub:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card:      { marginBottom: Spacing.md },
  reason:    { ...Typography.bodyMd, color: Colors.onSurface },
  docRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  docBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  docLabel:  { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  docFile:   { ...Typography.caption, color: Colors.onSurfaceVariant, flexShrink: 1 },
  error:     { ...Typography.labelMd, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  btn:       { marginTop: Spacing.sm },
});
