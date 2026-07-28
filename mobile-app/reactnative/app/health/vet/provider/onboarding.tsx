import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, Clock, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import CredentialBadge from '@/features/health/components/CredentialBadge';
import { useProviderProfile, useSubmitProviderOnboarding } from '@/features/health/vet/hooks';

export default function ProviderOnboardingScreen() {
  const { data: profile, isLoading, isError, refetch } = useProviderProfile();
  const submit = useSubmitProviderOnboarding();

  const [displayName, setDisplayName] = useState('');
  const [vcn, setVcn] = useState('');
  const [clinic, setClinic] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    setErrors(e);
    if (Object.keys(e).length) return;
    submit.mutate(
      { displayName: displayName.trim(), vcnLicenseNo: vcn.trim(), clinicName: clinic.trim() },
      { onSuccess: () => refetch() },
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
  statusCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, alignItems: 'center' },
  statusIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { ...Typography.headlineMd, fontSize: 20, color: Colors.onSurface },
  statusSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 19 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
