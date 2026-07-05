import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleCheck, CircleAlert, Clock } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

import { useProviderOnboarding, useSubmitProviderOnboarding } from '@/features/health/lab/hooks';
import type { ProviderOnboardingState } from '@/features/health/lab/types';

type Tone = 'info' | 'ok' | 'warn';

function bannerFor(status: ProviderOnboardingState['status']): {
  label: string;
  message: string;
  tone: Tone;
} {
  switch (status) {
    case 'approved':
      return {
        label: 'Verified',
        message: 'Your facility is MLSCN-verified and discoverable to patients.',
        tone: 'ok',
      };
    case 'needs_info':
      return {
        label: 'More info needed',
        message: 'MLSCN review needs additional information. Update the details below and resubmit.',
        tone: 'warn',
      };
    case 'under_review':
      return {
        label: 'Under review',
        message: 'Your submission is being reviewed against MLSCN records.',
        tone: 'info',
      };
    case 'submitted':
      return {
        label: 'Submitted',
        message: 'Your facility details have been submitted for HL-2 verification.',
        tone: 'info',
      };
    case 'draft':
    default:
      return {
        label: 'Draft',
        message: 'Complete your facility details to begin MLSCN verification.',
        tone: 'info',
      };
  }
}

function toneColor(tone: Tone): string {
  if (tone === 'ok') return Colors.teal;
  if (tone === 'warn') return Colors.onWarning;
  return Colors.secondary;
}

export default function LabProviderOnboardingScreen() {
  const onboarding = useProviderOnboarding();
  const submit = useSubmitProviderOnboarding();

  const [businessName, setBusinessName] = useState('');
  const [mlscnLicenseNo, setMlscnLicenseNo] = useState('');
  const [contactName, setContactName] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const data = onboarding.data;

  useEffect(() => {
    if (!data) return;
    setBusinessName((prev) => (prev ? prev : data.businessName ?? ''));
    setMlscnLicenseNo((prev) => (prev ? prev : data.mlscnLicenseNo ?? ''));
    setContactName((prev) => (prev ? prev : data.contactName ?? ''));
  }, [data]);

  if (onboarding.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Facility verification" subtitle="MLSCN" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (onboarding.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Facility verification" subtitle="MLSCN" />
        <StateView
          kind="error"
          title="Couldn't load onboarding"
          message="Please try again."
          actionLabel="Retry"
          onAction={() => onboarding.refetch()}
        />
      </SafeAreaView>
    );
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Facility verification" subtitle="MLSCN" />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Submitted for verification"
          message="Your facility details are now in HL-2 MLSCN verification. We'll notify you once your lab is approved and discoverable."
          actionLabel="Done"
          onAction={() => setSubmitted(false)}
        />
      </SafeAreaView>
    );
  }

  const banner = bannerFor(data?.status ?? 'draft');
  const color = toneColor(banner.tone);
  const BannerIcon = banner.tone === 'ok' ? CircleCheck : banner.tone === 'warn' ? CircleAlert : Clock;

  const canSubmit =
    businessName.trim().length > 0 &&
    mlscnLicenseNo.trim().length > 0 &&
    contactName.trim().length > 0;

  const onSubmit = async () => {
    await submit.mutateAsync({
      businessName: businessName.trim(),
      mlscnLicenseNo: mlscnLicenseNo.trim(),
      contactName: contactName.trim(),
    });
    setSubmitted(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Facility verification" subtitle="MLSCN" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.banner, { backgroundColor: Colors.surfaceContainerLow, borderColor: color }]}>
          <BannerIcon size={20} color={color} />
          <View style={styles.bannerText}>
            <Text style={[styles.bannerLabel, { color }]}>{banner.label}</Text>
            <Text style={styles.bannerMessage}>{banner.message}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Facility details</Text>
          <TextInputField
            label="Business name"
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="e.g. Lifeline Diagnostics Ltd"
          />
          <TextInputField
            label="Contact name"
            value={contactName}
            onChangeText={setContactName}
            placeholder="Primary contact person"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>MLSCN licence</Text>
          <TextInputField
            label="Licence number"
            value={mlscnLicenseNo}
            onChangeText={setMlscnLicenseNo}
            placeholder="MLSCN/LAB/0000"
          />
          <Text style={styles.note}>
            Your lab becomes discoverable to patients only once your MLSCN licence is verified (HL-2).
          </Text>
        </View>

        <PrimaryButton
          label="Submit for verification"
          onPress={onSubmit}
          loading={submit.isPending}
          disabled={!canSubmit}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  banner: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  bannerText: { flex: 1, gap: 2 },
  bannerLabel: { ...Typography.labelLg },
  bannerMessage: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...shadow1,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
