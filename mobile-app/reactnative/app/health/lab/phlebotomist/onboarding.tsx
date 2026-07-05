import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleCheck, CircleAlert, Clock, ShieldCheck } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { router } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

import { useProviderOnboarding, useSubmitProviderOnboarding } from '@/features/health/lab/hooks';

export default function PhlebotomistOnboardingScreen() {
  const onboarding = useProviderOnboarding();
  const submit = useSubmitProviderOnboarding();

  const [fullName, setFullName] = useState('');
  const [mlscnLicenseNo, setMlscnLicenseNo] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const status: string | undefined = (onboarding.data as any)?.status;

  const onSubmit = async () => {
    await submit.mutateAsync({
      businessName: fullName.trim(),
      mlscnLicenseNo: mlscnLicenseNo.trim(),
      contactName: fullName.trim(),
    });
    setSubmitted(true);
  };

  if (onboarding.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Phlebotomist onboarding" subtitle="MLSCN verification" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (onboarding.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Phlebotomist onboarding" subtitle="MLSCN verification" />
        <StateView
          kind="error"
          title="Could not load onboarding"
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
        <ScreenHeader title="Phlebotomist onboarding" subtitle="MLSCN verification" />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Application submitted"
          message="Your MLSCN details are under review. You become assignable for collections once verified."
          actionLabel="Done"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  const banner = (() => {
    if (status === 'approved') {
      return { Icon: CircleCheck, bg: Colors.tertiaryContainer, fg: Colors.teal, text: 'Verified — you can receive collection assignments.' };
    }
    if (status === 'needs_info') {
      return { Icon: CircleAlert, bg: Colors.errorContainer, fg: Colors.onWarning, text: 'We need more information to verify your MLSCN registration.' };
    }
    return { Icon: Clock, bg: Colors.surfaceContainerHigh, fg: Colors.secondary, text: 'Submit your details to start verification.' };
  })();

  const BannerIcon = banner.Icon;
  const canSubmit = fullName.trim().length > 0 && mlscnLicenseNo.trim().length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Phlebotomist onboarding" subtitle="MLSCN verification" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.banner, { backgroundColor: banner.bg }]}>
          <BannerIcon size={20} color={banner.fg} />
          <Text style={[styles.bannerText, { color: banner.fg }]}>{banner.text}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your details</Text>
          <TextInputField
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="e.g. Amaka Okafor"
          />
          <TextInputField
            label="Phone number"
            value={phone}
            onChangeText={setPhone}
            placeholder="e.g. 0803 000 0000"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>MLSCN registration</Text>
          <TextInputField
            label="MLSCN licence number"
            value={mlscnLicenseNo}
            onChangeText={setMlscnLicenseNo}
            placeholder="e.g. MLS/PHL/12345"
          />
          <View style={styles.noteRow}>
            <ShieldCheck size={16} color={Colors.onSurfaceVariant} />
            <Text style={styles.noteText}>
              You become assignable for sample collection only once your MLSCN licence is verified (HL-2).
            </Text>
          </View>
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
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
  },
  bannerText: { ...Typography.bodyMd, flex: 1 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...shadow1,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  noteRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
});
