import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow } from '@/features/doctor/components';
import { useProfileDraft } from '@/features/doctor/hooks';
import { SPECIALTY_OPTIONS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.profile.api';

export default function ProfilePreviewScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Profile preview" />
        <StateView variant="loading" label="Loading preview" />
      </SafeAreaView>
    );
  }

  if (isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Profile preview" />
        <StateView variant="error" message="We could not load your profile." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  const p = draft.personalInfo;
  const fullName = `${p.title} ${p.firstName} ${p.lastName}`.trim();
  const initials = `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase();
  const specialty = SPECIALTY_OPTIONS.find((s) => s.id === draft.specialtyId)?.label ?? draft.specialtyId;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Profile preview" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <DoctorAvatar initials={initials || 'DR'} color={Colors.primary} size={72} />
          <Text style={styles.name}>{fullName}</Text>
          <Text style={styles.specialty}>{specialty}{draft.yearsExperience ? ` · ${draft.yearsExperience} yrs` : ''}</Text>
        </View>

        <SectionCard title="About" style={styles.card}>
          <Text style={styles.bio}>{draft.bio}</Text>
        </SectionCard>

        <SectionCard title="Focus & languages" style={styles.card}>
          <InfoRow label="Sub-specialties" value={draft.subSpecialtyIds.join(', ') || '—'} />
          <InfoRow label="Languages" value={draft.languages.join(', ') || '—'} />
        </SectionCard>

        <SectionCard title="Pricing" style={styles.card}>
          <InfoRow label="Video" value={formatKobo(draft.pricing.videoFeeKobo)} />
          <InfoRow label="Audio" value={formatKobo(draft.pricing.audioFeeKobo)} />
          <InfoRow label="Chat" value={formatKobo(draft.pricing.chatFeeKobo)} />
          <InfoRow label="Instant consults" value={draft.pricing.acceptsInstant ? 'Accepted' : 'Off'} />
        </SectionCard>

        <SectionCard title="Credentials" style={styles.card}>
          <InfoRow label="Licence" value={draft.licence.licenceNumber} />
          <InfoRow label="Education" value={`${draft.education.length} entries`} />
          <InfoRow label="Work experience" value={`${draft.workExperience.length} entries`} />
          <InfoRow label="Affiliations" value={`${draft.affiliations.length} entries`} />
          <InfoRow label="Certificates" value={`${draft.certificates.length} uploaded`} />
        </SectionCard>

        <SectionCard title="Payout & tax" style={styles.card}>
          <InfoRow label="Bank" value={draft.bankAccount?.bankName ?? 'Not set'} />
          <InfoRow label="Account" value={draft.bankAccount?.accountName ?? 'Not set'} />
          <InfoRow label="TIN" value={draft.taxInfo?.hasTin ? (draft.taxInfo.tin ?? 'Yes') : 'Not provided'} />
        </SectionCard>

        <PrimaryButton label="Submit for verification" onPress={() => router.push('/(doctor)/profile/setup/submit')} style={styles.btn} />
        <PrimaryButton label="Back to steps" onPress={() => router.push('/(doctor)/profile/setup')} variant="secondary" style={styles.btnGap} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  hero:      { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.lg },
  name:      { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm },
  specialty: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:      { marginBottom: Spacing.md },
  bio:       { ...Typography.bodyMd, color: Colors.onSurface },
  btn:       { marginTop: Spacing.sm },
  btnGap:    { marginTop: Spacing.sm },
});
