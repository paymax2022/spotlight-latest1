import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Lock, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import MoneyAmount from '@/features/connect/components/wallet-MoneyAmount';
import { formatKobo } from '@/features/connect/constants/format';
import { usePayoutEligibility, useRequestPayout } from '@/features/connect/wallet/hooks';
import { moneyErrorMessage, isDuplicateReplay } from '@/features/connect/wallet/errors';
import { useIdempotencyKey } from '@/utils/idempotency';
import { sanitizeMoneyInput, nairaStringToKobo } from '@/utils/money';

// WL-20 — Creator payout request. Tier2+ & KYC gated (server re-checks). The
// request carries an Idempotency-Key (set in the api layer).
export default function PayoutRequest() {
  const elig = usePayoutEligibility();
  const request = useRequestPayout();
  // Stable across retries so a timeout replay is deduped, never double-posted.
  const { key: idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();
  const [naira, setNaira] = useState('');

  const amountKobo = useMemo(() => nairaStringToKobo(naira), [naira]);

  if (elig.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Request payout" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (elig.error || !elig.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Request payout" />
        <StateView kind="error" title="Couldn't load payouts" actionLabel="Retry" onAction={() => elig.refetch()} />
      </SafeAreaView>
    );
  }

  const e = elig.data;

  // KYC / tier gate — withdraw is only available at Tier 2+ with completed KYC.
  if (!e.eligible) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Request payout" />
        <View style={styles.gatedWrap}>
          <View style={styles.gatedIcon}><Lock size={32} color={Colors.gold} /></View>
          <Text style={styles.gatedTitle}>Withdrawals are locked</Text>
          <Text style={styles.gatedMsg}>{e.reason ?? 'Reach Tier 2 (ID + proof of address) to withdraw gift revenue.'}</Text>
          <PrimaryButton label="Upgrade tier" onPress={() => router.replace('/connect/wallet/tier/upgrade-intro')} />
        </View>
      </SafeAreaView>
    );
  }

  const overMin = amountKobo >= e.minPayoutKobo;
  const overAvail = amountKobo > e.availableKobo;
  const valid = amountKobo > 0 && overMin && !overAvail;

  const onSubmit = () => {
    if (!valid) return;
    request.mutate(
      { amountKobo, idempotencyKey },
      {
        onSuccess: () => {
          resetIdempotencyKey();
          router.replace('/connect/wallet/payouts/history');
        },
        onError: (err: unknown) => {
          // A 409 means the first attempt already registered the payout.
          if (isDuplicateReplay(err)) {
            resetIdempotencyKey();
            router.replace('/connect/wallet/payouts/history');
            return;
          }
          Alert.alert('Payout failed', moneyErrorMessage(err));
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request payout" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.availRow}>
          <Text style={styles.availLabel}>Available</Text>
          <MoneyAmount kobo={e.availableKobo} size="md" />
        </View>

        <Text style={styles.label}>Amount (₦)</Text>
        <TextInputField
          value={naira}
          onChangeText={(t) => setNaira(sanitizeMoneyInput(t))}
          keyboardType="decimal-pad"
          placeholder="0"
          inputMode="decimal"
          maxLength={13}
          error={amountKobo > 0 && !overMin ? `Minimum payout is ${formatKobo(e.minPayoutKobo)}` : overAvail ? 'Amount exceeds your available balance' : undefined}
        />
        <Pressable onPress={() => setNaira(String(Math.trunc(e.availableKobo / 100)))}>
          <Text style={styles.maxLink}>Withdraw all ({formatKobo(e.availableKobo)})</Text>
        </Pressable>

        <TierLimitBar tier={e.tier} />

        <View style={styles.methodRow}>
          <Text style={styles.methodLabel}>To</Text>
          <Text style={styles.methodValue}>{e.payoutMethodMasked}</Text>
        </View>

        <View style={styles.note}>
          <Info size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.noteText}>
            Payouts are reviewed and settled to your linked bank account. A small processing fee may apply.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={valid ? `Request ${formatKobo(amountKobo)}` : 'Enter an amount'}
          onPress={onSubmit}
          disabled={!valid}
          loading={request.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  availRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  availLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  maxLink: { ...Typography.labelMd, color: Colors.primary },
  methodRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg, padding: Spacing.md,
  },
  methodLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  methodValue: { ...Typography.labelLg, color: Colors.onSurface },
  note: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  gatedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  gatedIcon: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  gatedTitle: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  gatedMsg: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
