import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useKycStatus } from '@/features/connect/wallet/hooks';

// WL-18 — Upgrade rejected. Shows the server-provided reason and routes back to
// the relevant step to retry.
const RETRY_ROUTE: Record<number, string> = {
  1: '/connect/wallet/tier/tier1-bvn-nin',
  2: '/connect/wallet/tier/tier2-id-address',
  3: '/connect/wallet/tier/tier3-liveness-edd',
};

export default function TierRejected() {
  const { data, isLoading, error, refetch } = useKycStatus();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Upgrade rejected" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (error || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Upgrade rejected" />
        <StateView kind="error" title="Couldn't load status" actionLabel="Retry" onAction={() => refetch()} />
      </SafeAreaView>
    );
  }

  const target = data.pendingTarget ?? ((data.tier + 1) as 1 | 2 | 3);
  const retry = RETRY_ROUTE[target];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Upgrade rejected" />
      <View style={styles.body}>
        <View style={styles.iconBox}><XCircle size={40} color={Colors.error} strokeWidth={1.8} /></View>
        <Text style={styles.title}>We couldn't approve your upgrade</Text>
        <Text style={styles.message}>
          {data.rejectionReason ?? 'One or more of your documents could not be verified. Please review and resubmit.'}
        </Text>
        <View style={styles.actions}>
          {retry ? <PrimaryButton label="Try again" onPress={() => router.replace(retry as never)} /> : null}
          <PrimaryButton label="Back to tier status" variant="secondary" onPress={() => router.replace('/connect/wallet/tier/status')} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  message: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
});
