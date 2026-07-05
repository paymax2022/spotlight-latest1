import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira } from '@/features/referral/constants/format';
import { useWithdrawQuote, useWithdraw } from '@/features/referral/earnings/hooks';
import type { WithdrawResult } from '@/features/referral/earnings/types';

// M-ERN-04 — Withdraw to wallet: move eligible earnings to the Spotlight wallet,
// instant. Money is integer kobo; the live mutation carries an Idempotency-Key.
const ERROR_COPY: Record<NonNullable<WithdrawResult['error']>, string> = {
  below_min: 'Amount is below the minimum withdrawal.',
  insufficient: 'You do not have that much ready to withdraw.',
  kyc_required: 'Complete identity verification to withdraw your earnings.',
  failed: 'Something went wrong. No money has moved — please try again.',
};

export default function WithdrawScreen() {
  const { data: quote, isLoading, isError, refetch } = useWithdrawQuote();
  const withdraw = useWithdraw();
  const [naira, setNaira] = useState('');
  const [result, setResult] = useState<WithdrawResult | null>(null);

  // User types naira; convert to integer kobo for the money path.
  const amountKobo = Math.round((parseFloat(naira) || 0) * 100);

  const validationError = (() => {
    if (!quote || !naira) return undefined;
    if (amountKobo <= 0) return 'Enter an amount';
    if (amountKobo < quote.minWithdrawKobo) return `Minimum is ${formatNaira(quote.minWithdrawKobo)}`;
    if (amountKobo > quote.eligibleKobo) return `You only have ${formatNaira(quote.eligibleKobo)} ready`;
    return undefined;
  })();

  if (result?.ok) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Withdrawal complete" showBack={false} />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title={`${formatNaira(result.amountKobo)} sent to wallet`}
          message={`Reference ${result.reference}. Your wallet balance is now ${formatNaira(result.walletBalanceKobo)}.`}
          actionLabel="Done"
          onAction={() => router.replace('/referral/(tabs)/earnings')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Withdraw to wallet" />
      {isLoading ? (
        <StateView kind="loading" message="Checking your balance…" />
      ) : isError || !quote ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Ready to withdraw</Text>
            <Text style={styles.balanceValue}>{formatNaira(quote.eligibleKobo)}</Text>
          </View>

          {!quote.withdrawable ? (
            <DisclosureCard tone="warn" title="Withdrawals locked" body={quote.blockedReason ?? 'Complete identity verification to withdraw your earnings.'} />
          ) : (
            <>
              <TextInputField
                label="Amount (₦)"
                placeholder="0"
                value={naira}
                onChangeText={(t) => { setNaira(t.replace(/[^0-9.]/g, '')); setResult(null); }}
                keyboardType="decimal-pad"
                error={validationError}
                leftIcon={<Wallet size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />}
              />

              <View style={styles.chipRow}>
                <Pressable style={styles.chip} onPress={() => setNaira(String(quote.minWithdrawKobo / 100))} accessibilityRole="button">
                  <Text style={styles.chipText}>Min {formatNaira(quote.minWithdrawKobo)}</Text>
                </Pressable>
                <Pressable style={styles.chip} onPress={() => setNaira(String(quote.eligibleKobo / 100))} accessibilityRole="button">
                  <Text style={styles.chipText}>All {formatNaira(quote.eligibleKobo)}</Text>
                </Pressable>
              </View>

              {quote.feeKobo > 0 && (
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>Fee</Text>
                  <Text style={styles.feeValue}>{formatNaira(quote.feeKobo)}</Text>
                </View>
              )}

              {result && !result.ok && result.error && (
                <DisclosureCard tone="danger" body={ERROR_COPY[result.error]} />
              )}

              <DisclosureCard tone="info" body="Earnings move to your Spotlight wallet instantly. They reflect rewards already earned from friends' verified activity." />

              <PrimaryButton
                label={naira ? `Withdraw ${formatNaira(amountKobo)}` : 'Withdraw to wallet'}
                onPress={() => withdraw.mutate(amountKobo, { onSuccess: setResult })}
                disabled={!naira || !!validationError}
                loading={withdraw.isPending}
              />
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  balanceCard: { backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, gap: 2 },
  balanceLabel: { ...Typography.labelMd, color: Colors.onPrimary, opacity: 0.85 },
  balanceValue: { ...Typography.displayLg, color: Colors.onPrimary, fontWeight: '800' as const },
  chipRow: { flexDirection: 'row', gap: Spacing.sm },
  chip: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingVertical: 10 },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  feeLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  feeValue: { ...Typography.labelMd, color: Colors.onSurface },
});
