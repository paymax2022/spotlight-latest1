import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet } from 'lucide-react-native';

import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';

import { useProviderEarnings } from '@/features/health/lab/hooks';
import type { ProviderEarnings } from '@/features/health/lab/types';
import { formatNaira, relativeTime } from '@/features/health/constants/health.constants';

type Payout = ProviderEarnings['withdrawals'][number];

function PayoutRow({ payout }: { payout: Payout }) {
  const isPaid = payout.status === 'paid';
  const isFailed = payout.status === 'failed';
  return (
    <View style={styles.payoutRow}>
      <View style={styles.payoutInfo}>
        <Text style={styles.payoutAmount}>{formatNaira(payout.amountKobo)}</Text>
        {payout.feeKobo > 0 ? <Text style={styles.payoutTime}>+ {formatNaira(payout.feeKobo)} fee</Text> : null}
        <Text style={styles.payoutTime}>{relativeTime(payout.at)}</Text>
      </View>
      <View style={[styles.statusPill, { backgroundColor: isPaid ? Colors.tertiaryContainer : isFailed ? Colors.errorContainer : Colors.surfaceContainerHigh }]}>
        <Text style={[styles.statusText, { color: isPaid ? Colors.teal : isFailed ? Colors.error : Colors.gold }]}>
          {isPaid ? 'Paid' : isFailed ? 'Failed' : 'Processing'}
        </Text>
      </View>
    </View>
  );
}

export default function LabProviderEarningsScreen() {
  const earnings = useProviderEarnings();

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
  const payouts = data.withdrawals ?? [];

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
                <Text style={styles.balanceLabel}>Wallet balance (before transfer fee)</Text>
              </View>
              <Text style={styles.balanceBig}>{formatNaira(data.availableKobo)}</Text>
              <View style={styles.subRows}>
                <View style={styles.subRow}>
                  <Text style={styles.subLabel}>Total earned from released results</Text>
                  <Text style={styles.subValue}>{formatNaira(data.earnedKobo)}</Text>
                </View>
                <View style={styles.subRow}>
                  <Text style={styles.subLabel}>Pending</Text>
                  <Text style={styles.subValue}>{formatNaira(data.pendingKobo)}</Text>
                </View>
                <View style={styles.subRow}>
                  <Text style={styles.subLabel}>Held (awaiting sign-off, credit or dispute)</Text>
                  <Text style={styles.subValue}>{formatNaira(data.heldKobo)}</Text>
                </View>
              </View>
            </View>
            <Text style={styles.heldNote}>
              Payment for an order is held until its result is released, then credited to your wallet (HL-9). Withdrawals use your wallet's bank transfer, with your transaction PIN.
            </Text>
            <PrimaryButton
              label="Withdraw to bank"
              onPress={() => router.push('/wallet/bank-transfer')}
              disabled={data.availableKobo <= 0}
            />
            <Text style={styles.sectionTitle}>Recent bank transfers</Text>
          </View>
        }
        ListEmptyComponent={
          <StateView kind="empty" icon="Banknote" title="No bank transfers yet" message="Transfers from your wallet to a bank will appear here." compact />
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
