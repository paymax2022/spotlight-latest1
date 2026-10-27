import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView, InfoRow } from '@/features/doctor/components';
import { useProfileDraft } from '@/features/doctor/hooks';
import { SPECIALTY_OPTIONS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.profile.api';
import type { UploadedFile } from '@/types/doctor.profile';

const GENDER_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

// ISO date → dd MMM yyyy-ish short form; blank/invalid → em dash.
const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fileLabel = (f?: UploadedFile): string => (f ? `${f.fileName} ✓` : 'Not uploaded');
const yearRange = (start?: number, end?: number, isCurrent?: boolean): string =>
  `${start ?? '—'} – ${isCurrent ? 'Present' : end ?? '—'}`;

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

        <SectionCard title="Personal information" style={styles.card}>
          <InfoRow label="Gender" value={p.gender ? GENDER_LABELS[p.gender] ?? '—' : '—'} />
          <InfoRow label="Date of birth" value={fmtDate(p.dateOfBirth)} />
          <InfoRow label="Email" value={p.email || '—'} />
          <InfoRow label="Phone" value={p.phone || '—'} />
          <InfoRow label="Location" value={[p.city, p.state].filter(Boolean).join(', ') || '—'} />
          <InfoRow label="Address" value={p.address || '—'} />
          <InfoRow label="Profile photo" value={fileLabel(draft.photo)} />
        </SectionCard>

        <SectionCard title="About" style={styles.card}>
          <Text style={styles.bio}>{draft.bio || '—'}</Text>
        </SectionCard>

        <SectionCard title="Focus & languages" style={styles.card}>
          <InfoRow label="Specialty" value={specialty} />
          <InfoRow label="Sub-specialties" value={draft.subSpecialtyIds.join(', ') || '—'} />
          <InfoRow label="Years of experience" value={draft.yearsExperience ? `${draft.yearsExperience}` : '—'} />
          <InfoRow label="Languages" value={draft.languages.join(', ') || '—'} />
        </SectionCard>

        <SectionCard title="Licence" style={styles.card}>
          <InfoRow label="Licence number" value={draft.licence.licenceNumber || '—'} />
          <InfoRow label="Issuing body" value={draft.licence.issuingBody || '—'} />
          {draft.licence.issuedAt && <InfoRow label="Issued" value={fmtDate(draft.licence.issuedAt)} />}
          {draft.licence.expiresAt && <InfoRow label="Expires" value={fmtDate(draft.licence.expiresAt)} />}
          <InfoRow label="Licence document" value={fileLabel(draft.licence.licenceFile)} />
        </SectionCard>

        <SectionCard title="Documents" style={styles.card}>
          {draft.documents.length === 0 && !draft.associationMembership && draft.certificates.length === 0 && (
            <Text style={styles.bio}>No documents uploaded yet.</Text>
          )}
          {draft.documents.map((d) => (
            <InfoRow key={d.type} label={d.label + (d.required ? ' *' : '')} value={fileLabel(d.file)} />
          ))}
          <InfoRow label="Association membership" value={fileLabel(draft.associationMembership)} />
          {draft.certificates.map((c, i) => (
            <InfoRow key={c.id} label={`Certificate ${i + 1}`} value={fileLabel(c)} />
          ))}
        </SectionCard>

        <SectionCard title="Affiliations" style={styles.card}>
          {draft.affiliations.length === 0 && <Text style={styles.bio}>None added.</Text>}
          {draft.affiliations.map((a, i) => (
            <InfoRow
              key={a.id}
              label={`${i + 1}. ${a.name}`}
              value={[a.role, a.city, a.state, a.isPrimary ? 'Primary' : null].filter(Boolean).join(' · ') || '—'}
            />
          ))}
        </SectionCard>

        <SectionCard title="Education" style={styles.card}>
          {draft.education.length === 0 && <Text style={styles.bio}>None added.</Text>}
          {draft.education.map((e, i) => (
            <InfoRow
              key={e.id}
              label={`${i + 1}. ${e.degree}${e.field ? ` · ${e.field}` : ''}`}
              value={`${e.institution} · ${yearRange(e.startYear, e.endYear, e.isCurrent)}`}
            />
          ))}
        </SectionCard>

        <SectionCard title="Work experience" style={styles.card}>
          {draft.workExperience.length === 0 && <Text style={styles.bio}>None added.</Text>}
          {draft.workExperience.map((w, i) => (
            <InfoRow
              key={w.id}
              label={`${i + 1}. ${w.role}`}
              value={[w.organisation, w.location, yearRange(w.startYear, w.endYear, w.isCurrent)].filter(Boolean).join(' · ')}
            />
          ))}
        </SectionCard>

        <SectionCard title="Pricing" style={styles.card}>
          <InfoRow label="Video" value={formatKobo(draft.pricing.videoFeeKobo)} />
          <InfoRow label="Audio" value={formatKobo(draft.pricing.audioFeeKobo)} />
          <InfoRow label="Chat" value={formatKobo(draft.pricing.chatFeeKobo)} />
          <InfoRow label="Instant consults" value={draft.pricing.acceptsInstant ? 'Accepted' : 'Off'} />
        </SectionCard>

        <SectionCard title="Free follow-ups" style={styles.card}>
          {draft.freeFollowUp.enabled ? (
            <>
              <InfoRow label="Policy" value={`${draft.freeFollowUp.maxFreeVisits} free follow-up${draft.freeFollowUp.maxFreeVisits === 1 ? '' : 's'} within ${draft.freeFollowUp.windowDays} days`} />
              {!!draft.freeFollowUp.note && <InfoRow label="Note" value={draft.freeFollowUp.note} />}
            </>
          ) : (
            <InfoRow label="Policy" value="Off" />
          )}
        </SectionCard>

        <SectionCard title="Payout" style={styles.card}>
          <InfoRow label="Bank" value={draft.bankAccount?.bankName ?? 'Not set'} />
          <InfoRow label="Account name" value={draft.bankAccount?.accountName ?? 'Not set'} />
          <InfoRow label="Account number" value={draft.bankAccount?.accountNumber ? `****${draft.bankAccount.accountNumber.slice(-4)}` : 'Not set'} />
          <InfoRow label="Verified" value={draft.bankAccount?.isVerified ? 'Yes' : 'No'} />
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
