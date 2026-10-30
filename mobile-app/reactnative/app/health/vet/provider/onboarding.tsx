import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, Clock, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import AddressAutocompleteInput from '@/components/AddressAutocompleteInput';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import { UploadField } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import { pickFileForField } from '@/features/registration/utils/filePicker';
import type { PickedUpload } from '@/features/registration/types/registration.types';
import { useProviderProfile, useSubmitProviderOnboarding } from '@/features/health/vet/hooks';

export default function ProviderOnboardingScreen() {
  const { data: profile, isLoading, isError, refetch } = useProviderProfile();
  const submit = useSubmitProviderOnboarding();

  const [displayName, setDisplayName] = useState('');
  const [vcn, setVcn] = useState('');
  const [clinic, setClinic] = useState('');
  const [clinicAddress, setClinicAddress] = useState('');
  const [clinicCity, setClinicCity] = useState('');
  const [clinicState, setClinicState] = useState('');
  // True when the picked place came with a state from the provider (field then read-only);
  // the field stays editable only as a fallback when the provider returned none.
  const [stateFromProvider, setStateFromProvider] = useState(false);
  const [clinicPoint, setClinicPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [submitErr, setSubmitErr] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadState, setUploadState] = useState<UploadFieldState>('empty');
  const [licenceFile, setLicenceFile] = useState<PickedUpload>();
  const [uploadErr, setUploadErr] = useState<string>();

  const pickLicence = async () => {
    setUploadErr(undefined);
    const file = await pickFileForField('.pdf,.jpg,.jpeg,.png');
    if (!file) return;
    setLicenceFile(file);
    setUploadState('selected');
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Vet onboarding" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (isError || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Vet onboarding" />
        <StateView kind="error" title="Couldn't load onboarding" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  // Already submitted / approved — show status.
  if (profile.status !== 'draft') {
    const approved = profile.status === 'approved';
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Vet onboarding" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.statusCard, shadow1]}>
            <View style={[styles.statusIcon, { backgroundColor: approved ? Colors.iconBgTeal : Colors.iconBgGold }]}>
              {approved ? (
                <BadgeCheck size={28} color={Colors.teal} strokeWidth={2} />
              ) : (
                <Clock size={28} color={Colors.onWarning} strokeWidth={2} />
              )}
            </View>
            <Text style={styles.statusTitle}>
              {approved ? 'You are verified' : 'Under review'}
            </Text>
            <Text style={styles.statusSub}>
              {approved
                ? 'Your VCN credential is verified. You are discoverable and can accept appointments.'
                : 'We are verifying your VCN credential. You will be notified once approved (HL-2). You cannot accept appointments until then.'}
            </Text>
            <CredentialBadge credential={profile.credential} showLicense />
          </View>

          {approved ? (
            <PrimaryButton label="Go to dashboard" onPress={() => router.replace('/health/vet/provider/requests')} />
          ) : (
            <PrimaryButton
              label="Verify your VCN licence →"
              onPress={() => router.push('/health/vet/provider/verification')}
            />
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const onSubmit = () => {
    const e: Record<string, string> = {};
    if (!displayName.trim()) e.displayName = 'Required';
    if (!vcn.trim()) e.vcn = 'VCN number is required';
    if (!clinic.trim()) e.clinic = 'Required';
    if (!clinicPoint) e.location = 'Search for your clinic address and pick it from the list so pet owners can find you.';
    setErrors(e);
    if (Object.keys(e).length || !clinicPoint) return;
    setUploadErr(undefined);
    setSubmitErr(undefined);
    submit.mutate(
      {
        displayName: displayName.trim(),
        vcnLicenseNo: vcn.trim(),
        clinicName: clinic.trim(),
        location: {
          address: clinicAddress.trim(),
          city: clinicCity.trim() || undefined,
          state: clinicState.trim() || undefined,
          lat: clinicPoint.lat,
          lng: clinicPoint.lng,
        },
        licenceFile: licenceFile ? { uri: licenceFile.uri, fileName: licenceFile.name, mimeType: licenceFile.mimeType } : undefined,
      },
      {
        onSuccess: () => refetch(),
        onError: (err) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setSubmitErr(msg ?? 'Could not submit your application. Please try again.');
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Vet onboarding" subtitle="Verify your VCN credential" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <ShieldCheck size={18} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.introText}>
            Paymax is a marketplace — all clinical care is delivered by VCN-registered vets. You become
            discoverable only after verification (HL-2).
          </Text>
        </View>

        <TextInputField label="Display name *" placeholder="Dr. …" value={displayName} onChangeText={setDisplayName} error={errors.displayName} />
        <TextInputField label="VCN registration number *" placeholder="e.g. VCN-2014-0912" value={vcn} onChangeText={setVcn} error={errors.vcn} />
        <TextInputField label="Clinic / practice name *" placeholder="Your clinic" value={clinic} onChangeText={setClinic} error={errors.clinic} />
        <Text style={styles.sectionLabel}>Clinic location *</Text>
        <AddressAutocompleteInput
          value={clinicAddress}
          onChangeText={(t) => {
            setClinicAddress(t);
            // Typing again invalidates the pinned point until a place is picked.
            setClinicPoint(null);
          }}
          onSelect={(a) => {
            setClinicAddress(a.label);
            setClinicCity(a.city ?? '');
            setClinicState(a.state ?? '');
            setStateFromProvider(!!a.state);
            setClinicPoint({ lat: a.lat, lng: a.lng });
            setErrors((prev) => ({ ...prev, location: '' }));
          }}
          placeholder="Search for your clinic address"
          resolved={clinicPoint != null}
          surface="delivery"
          inlineDropdown
        />
        {errors.location ? <Text style={styles.errorText}>{errors.location}</Text> : null}
        {clinicPoint ? (
          <View style={styles.locRow}>
            <View style={styles.locCol}>
              <TextInputField label="City" placeholder="Lagos" value={clinicCity} onChangeText={setClinicCity} maxLength={100} />
            </View>
            <View style={styles.locCol}>
              <TextInputField label="State" placeholder="Lagos" value={clinicState} onChangeText={setClinicState} maxLength={100} editable={!stateFromProvider} />
            </View>
          </View>
        ) : null}
        <UploadField
          label="VCN licence document"
          state={uploadState}
          fileName={licenceFile?.name}
          errorText={uploadErr}
          hint="PDF, JPG or PNG"
          onPick={pickLicence}
        />
        {submitErr ? <Text style={styles.errorText}>{submitErr}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit for verification" onPress={onSubmit} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  introText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  errorText: { ...Typography.labelSm, color: Colors.error },
  locRow: { flexDirection: 'row', gap: Spacing.sm },
  locCol: { flex: 1 },
  statusCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, alignItems: 'center' },
  statusIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { ...Typography.headlineMd, fontSize: 20, color: Colors.onSurface },
  statusSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 19 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
