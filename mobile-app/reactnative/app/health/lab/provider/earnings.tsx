import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Wallet } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';

import { useProviderEarnings, useRequestPayout } from '@/features/health/lab/hooks';
import type { ProviderEarnings } from '@/features/health/lab/types';
import { formatNaira, relativeTime } from '@/features/health/constants/health.constants';

type Payout = ProviderEarnings['payouts'][number];

function PayoutRow({ payout }: { payout: Payout }) {
  const isPaid = payout.status === 'paid';
  return (
    <View style={styles.payoutRow}>
      <View style={styles.payoutInfo}>
        <Text style={styles.payoutAmount}>{formatNaira(payout.amountKobo)}</Text>
        <Text style={styles.payoutTime}>{relativeTime(payout.at)}</Text>
      </View>
      <View style={[styles.statusPill, { backgroundColor: isPaid ? Colors.tertiaryContainer : Colors.surfaceContainerHigh }]}>
        <Text style={[styles.statusText, { color: isPaid ? Colors.teal : Colors.gold }]}>
          {isPaid ? 'Paid' : 'Processing'}
        </Text>
      </View>
    </View>
  );
}

export default function LabProviderEarningsScreen() {
  const earnings = useProviderEarnings();
  const requestPayout = useRequestPayout();

  if (earnings.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Earnings" subtitle="Payouts" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (earnings.isError || !earnings.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Earnings" subtitle="Payouts" />
        <StateView
          kind="error"
          title="Couldn't load earnings"
          message="Please try again."
          actionLabel="Retry"
          onAction={() => earnings.refetch()}
        />
      </SafeAreaView>
    );
  }

  const data = earnings.data;
  const payouts = data.payouts ?? [];

  const onRequestPayout = async () => {
    await requestPayout.mutateAsync(data.availableKobo);
    earnings.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings" subtitle="Payouts" />
      <FlatList
        data={payouts}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => <PayoutRow payout={item} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <View style={styles.balanceCard}>
              <View style={styles.balanceTop}>
                <Wallet size={20} color={Colors.onPrimary} />
                <Text style={styles.balanceLabel}>Available balance</Text>
              </View>
              <Text style={styles.balanceBig}>{formatNaira(data.availableKobo)}</Text>
              <View style={styles.subRows}>
                <View style={styles.subRow}>
                  <Text style={styles.subLabel}>Pending</Text>
                  <Text style={styles.subValue}>{formatNaira(data.pendingKobo)}</Text>
                </View>
                <View style={styles.subRow}>
                  <Text style={styles.subLabel}>Held (awaiting release)</Text>
                  <Text style={styles.subValue}>{formatNaira(data.heldKobo)}</Text>
                </View>
              </View>
            </View>
            <Text style={styles.heldNote}>
              Funds are held until the corresponding result is released (HL-9).
            </Text>
            <PrimaryButton
              label="Request payout"
              onPress={onRequestPayout}
              loading={requestPayout.isPending}
              disabled={data.availableKobo <= 0}
            />
            <Text style={styles.sectionTitle}>Recent payouts</Text>
          </View>
        }
        ListEmptyComponent={
          <StateView kind="empty" icon="Banknote" title="No payouts yet" message="Your payout history will appear here." compact />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  headerWrap: { gap: Spacing.md, marginBottom: Spacing.sm },
  balanceCard: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  balanceTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  balanceLabel: { ...Typography.labelLg, color: Colors.onPrimary },
  balanceBig: { ...Typography.headlineMd, color: Colors.onPrimary },
  subRows: { gap: Spacing.xs },
  subRow: { flexDirection: 'row', justifyContent: 'space-between' },
  subLabel: { ...Typography.bodySm, color: Colors.onPrimary, opacity: 0.85 },
  subValue: { ...Typography.labelMd, color: Colors.onPrimary },
  heldNote: { ...Typography.caption, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  payoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...shadow1,
  },
  payoutInfo: { gap: 2 },
  payoutAmount: { ...Typography.titleMd, color: Colors.onSurface },
  payoutTime: { ...Typography.caption, color: Colors.onSurfaceVariant },
  statusPill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  statusText: { ...Typography.labelSm },
});
