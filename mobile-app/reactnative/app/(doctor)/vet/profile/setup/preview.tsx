import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow } from '@/features/doctor/components';
import { useVetProfileDraft, useSubmitVetVerification } from '@/features/doctor/hooks';
import { VET_SPECIALTY_OPTIONS, PET_SPECIES_LABELS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.batch1.api';

export default function VetProfilePreviewScreen() {
  const { data: draft, isLoading, isError, refetch } = useVetProfileDraft();
  const submit = useSubmitVetVerification();
  const [error, setError] = useState<string>();

  const handleSubmit = async () => {
    if (!draft) return;
    setError(undefined);
    try {
      await submit.mutateAsync({ draftId: draft.id });
      router.replace('/(doctor)/vet/profile/verification');
    } catch {
      setError('Submission failed. Please try again.');
    }
  };

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
  const specialty = VET_SPECIALTY_OPTIONS.find((s) => s.id === draft.specialtyId)?.label ?? draft.specialtyId;
  const species = draft.speciesTreated.map((s) => PET_SPECIES_LABELS[s]).join(', ');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Profile preview" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <DoctorAvatar initials={initials || 'VT'} color={Colors.primary} size={72} />
          <Text style={styles.name}>{fullName}</Text>
          <Text style={styles.specialty}>{specialty}{draft.yearsExperience ? ` · ${draft.yearsExperience} yrs` : ''}</Text>
        </View>

        <SectionCard title="About" style={styles.card}>
          <Text style={styles.bio}>{draft.bio || 'No bio provided.'}</Text>
        </SectionCard>

        <SectionCard title="Focus" style={styles.card}>
          <InfoRow label="Species treated" value={species || '—'} />
          <InfoRow label="Sub-specialties" value={draft.subSpecialtyIds.join(', ') || '—'} />
        </SectionCard>

        <SectionCard title="Pricing" style={styles.card}>
          <InfoRow label="Video" value={formatKobo(draft.pricing.videoFeeKobo)} />
          <InfoRow label="Audio" value={formatKobo(draft.pricing.audioFeeKobo)} />
          <InfoRow label="Chat" value={formatKobo(draft.pricing.chatFeeKobo)} />
          <InfoRow label="Instant consults" value={draft.pricing.acceptsInstant ? 'Accepted' : 'Off'} />
        </SectionCard>

        <SectionCard title="Credentials" style={styles.card}>
          <InfoRow label="Licence" value={draft.licence.licenceNumber} />
          <InfoRow label="Licence file" value={draft.licence.licenceFile ? 'Uploaded' : 'Not uploaded'} />
          <InfoRow label="Experience" value={`${draft.workExperience.length} entries`} />
          <InfoRow label="Affiliations" value={`${draft.affiliations.length} entries`} />
          <InfoRow label="Certificates" value={`${draft.certificates.length} uploaded`} />
        </SectionCard>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <PrimaryButton label="Submit for verification" onPress={handleSubmit} loading={submit.isPending} style={styles.btn} />
        <PrimaryButton label="Back to steps" onPress={() => router.push('/(doctor)/vet/profile/setup')} variant="secondary" style={styles.btnGap} />
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
  error:     { ...Typography.labelMd, color: Colors.error, textAlign: 'center', marginBottom: Spacing.sm },
  btn:       { marginTop: Spacing.sm },
  btnGap:    { marginTop: Spacing.sm },
});
