import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock, CircleCheck, CircleX, SearchCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useVerification, useRestartKyc } from '@/features/fx/hooks/useFxKyc';
import { TIER_LABELS } from '@/features/fx/constants/fx.constants';
import type { VerificationStatus } from '@/features/fx/types/fx.types';

const VIEW: Record<Exclude<VerificationStatus, 'unstarted'>, {
  icon: React.ReactNode; bg: string; title: string; message: string;
}> = {
  pending: {
    icon: <Clock size={56} color={Colors.onPrimaryFixedVariant} strokeWidth={1.8} />, bg: Colors.iconBgPurple,
    title: 'Verification pending', message: "Your identity is being checked. This usually takes a few minutes — we'll notify you the moment it's done.",
  },
  review: {
    icon: <SearchCheck size={56} color={Colors.secondary} strokeWidth={1.8} />, bg: Colors.iconBgBlue,
    title: 'Account under review', message: 'Your business details are with our compliance team. Reviews typically complete within 1–2 business days.',
  },
  approved: {
    icon: <CircleCheck size={56} color={Colors.tertiaryContainer} strokeWidth={1.8} />, bg: Colors.iconBgTeal,
    title: 'Verification approved 🎉', message: 'You\'re all set. You can now convert, send, receive and hold balances across currencies.',
  },
  rejected: {
    icon: <CircleX size={56} color={Colors.error} strokeWidth={1.8} />, bg: Colors.errorContainer,
    title: 'Verification unsuccessful', message: 'We couldn\'t verify some of your details. Please review and resubmit — make sure your documents are clear and valid.',
  },
};

export default function KycStatusScreen() {
  // Optional ?status= override lets every state be viewed (also used by QA).
  const params = useLocalSearchParams<{ status?: string }>();
  const { data, isLoading, isError, refetch } = useVerification();
  const restart = useRestartKyc();

  const status = (params.status as VerificationStatus) || data?.status || 'pending';

  if (isLoading && !params.status) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Verification" /><StateView kind="loading" /></SafeAreaView>;
  }
  if (isError && !params.status) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Verification" /><StateView kind="error" title="Couldn't load status" actionLabel="Retry" onAction={() => refetch()} /></SafeAreaView>;
  }
  if (status === 'unstarted') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScreenHeader title="Verification" />
        <StateView kind="empty" icon="ShieldCheck" title="Not verified yet" message="Verify your account to unlock FX, payouts and cards." actionLabel="Start verification" onAction={() => router.replace('/fx/kyc')} />
      </SafeAreaView>
    );
  }

  const v = VIEW[status as Exclude<VerificationStatus, 'unstarted'>];

  const resubmit = async () => { await restart.mutateAsync(); router.replace('/fx/kyc'); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verification" />
      <View style={styles.center}>
        <View style={[styles.ring, { backgroundColor: v.bg }]}>{v.icon}</View>
        <Text style={styles.title}>{v.title}</Text>
        <Text style={styles.sub}>{v.message}</Text>
        {data?.tier ? (
          <View style={styles.tierPill}><Text style={styles.tierText}>{TIER_LABELS[data.tier] ?? `Tier ${data.tier}`}</Text></View>
        ) : null}
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {status === 'rejected' ? (
          <PrimaryButton label="Resubmit verification" onPress={resubmit} loading={restart.isPending} />
        ) : status === 'approved' ? (
          <PrimaryButton label="Start using FX" onPress={() => router.dismissTo('/fx')} />
        ) : (
          <PrimaryButton label="Done" onPress={() => router.dismissTo('/fx')} />
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
  tierPill: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6, marginTop: Spacing.xs },
  tierText: { ...Typography.labelMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
