import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Wallet, ShieldCheck, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useProviderEarnings } from '@/features/health/pharmacy/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';

export default function ProviderEarningsScreen() {
  const { data, isLoading, isError, refetch } = useProviderEarnings();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Earnings" />
        <StateView kind="loading" message="Loading earnings…" />
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Earnings" />
        <StateView kind="error" title="Couldn't load earnings" message="Please try again." actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings" subtitle="What escrow has settled" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, shadow1]}>
          <View style={styles.heroHead}>
            <Wallet size={18} color={Colors.onPrimary} strokeWidth={2} />
            <Text style={styles.heroLabel}>Released to you</Text>
          </View>
          <Text style={styles.heroAmount}>{formatNaira(data.availableKobo)}</Text>
          <Text style={styles.heroPending}>
            {formatNaira(data.pendingKobo)} still held on open orders · {data.ordersPaid} order
            {data.ordersPaid === 1 ? '' : 's'} settled all-time
          </Text>
        </View>

        {/* HL-9: the release is a consequence of completing the order, not a request. */}
        <View style={styles.settleStrip}>
          <Lock size={15} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.settleText}>
            There is no payout to request. When an order is delivered or collected, the held money is released to this
            account automatically. Your lever on it is completing the order.
          </Text>
        </View>

        <View style={styles.hlStrip}>
          <ShieldCheck size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.hlText}>
            Released figures come from the escrow ledger, not from order statuses — an order that was cancelled or
            refunded never contributed.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  hero: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heroLabel: { ...Typography.labelMd, color: Colors.onPrimary, opacity: 0.85 },
  heroAmount: { ...Typography.displayLg, fontSize: 40, letterSpacing: -0.8, lineHeight: 48, color: Colors.onPrimary },
  heroPending: { ...Typography.bodySm, color: Colors.onPrimary, opacity: 0.85, lineHeight: 19 },
  settleStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  settleText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  hlStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  hlText: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
});
