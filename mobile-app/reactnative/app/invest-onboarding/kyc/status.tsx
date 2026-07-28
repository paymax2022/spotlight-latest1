import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock, CircleCheck, CircleX, SearchCheck, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useKycStatus } from '@/features/investonboarding/hooks/useOnboarding';
import { KYC_PRIVACY_NOTE } from '@/features/investonboarding/constants/onboarding.constants';
import { resetKycDraft } from '@/features/investonboarding/utils/onboardingDraft';
import type { KycStatus } from '@/features/investonboarding/types/onboarding.types';

const VIEW: Record<Exclude<KycStatus, 'unstarted'>, {
  icon: React.ReactNode; bg: string; title: string; message: string;
}> = {
  pending: {
    icon: <Clock size={56} color={Colors.onPrimaryFixedVariant} strokeWidth={1.8} />, bg: Colors.iconBgPurple,
    title: 'Verification in progress', message: "We're checking your details. This usually takes a few minutes — we'll notify you the moment it's done.",
  },
  review: {
    icon: <SearchCheck size={56} color={Colors.secondary} strokeWidth={1.8} />, bg: Colors.iconBgBlue,
    title: 'Under manual review', message: 'Your details are with our compliance team. Reviews typically complete within 1–2 business days.',
  },
  approved: {
    icon: <CircleCheck size={56} color={Colors.tertiaryContainer} strokeWidth={1.8} />, bg: Colors.iconBgTeal,
    title: 'Identity verified', message: "You're verified. Next, let's understand your goals so we can suggest suitable products.",
  },
  rejected: {
    icon: <CircleX size={56} color={Colors.error} strokeWidth={1.8} />, bg: Colors.errorContainer,
    title: 'Verification unsuccessful', message: "We couldn't verify some details. Please review and resubmit with clear, valid documents.",
  },
};

export default function KycStatusScreen() {
  // Optional ?status= override lets every state be viewed (QA).
  const params = useLocalSearchParams<{ status?: string }>();
  const { data, isLoading, isError, refetch } = useKycStatus();
  const status = (params.status as KycStatus) || data || 'unstarted';

  const startKyc = () => { resetKycDraft(); router.push('/invest-onboarding/kyc/personal'); };

  if (isLoading && !params.status) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Verification" /><StateView kind="loading" /></SafeAreaView>;
  }
  if (isError && !params.status) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Verification" /><StateView kind="error" title="Couldn't load status" actionLabel="Retry" onAction={() => refetch()} /></SafeAreaView>;
  }

  if (status === 'unstarted') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verify your identity" />
        <View style={styles.center}>
          <View style={[styles.ring, { backgroundColor: Colors.iconBgPurple }]}>
            <ShieldCheck size={56} color={Colors.primary} strokeWidth={1.8} />
          </View>
          <Text style={styles.title}>Let's verify it's you</Text>
          <Text style={styles.sub}>
            A quick, secure check using your government ID. It's a legal requirement and protects your account.
          </Text>
          <Text style={styles.privacy}>{KYC_PRIVACY_NOTE}</Text>
        </View>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Start verification" onPress={startKyc} />
        </SafeAreaView>
      </SafeAreaView>
    );
  }

  const v = VIEW[status as Exclude<KycStatus, 'unstarted'>];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verification" />
      <View style={styles.center}>
        <View style={[styles.ring, { backgroundColor: v.bg }]}>{v.icon}</View>
        <Text style={styles.title}>{v.title}</Text>
        <Text style={styles.sub}>{v.message}</Text>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {status === 'rejected' ? (
          <PrimaryButton label="Resubmit verification" onPress={startKyc} />
        ) : status === 'approved' ? (
          <PrimaryButton label="Continue to suitability" onPress={() => router.push('/invest-onboarding/suitability')} />
        ) : (
          <PrimaryButton label="Done" onPress={() => router.dismissTo('/invest-onboarding')} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 104, height: 104, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  privacy: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
