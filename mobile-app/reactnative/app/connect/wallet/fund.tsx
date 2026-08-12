import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet, Info } from 'lucide-react-native';
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
import { useWalletSummary, useFundWallet } from '@/features/connect/wallet/hooks';
import { moneyErrorMessage, isDuplicateReplay } from '@/features/connect/wallet/errors';
import { useIdempotencyKey } from '@/utils/idempotency';
import { sanitizeMoneyInput, nairaStringToKobo } from '@/utils/money';

// WL-02 — Fund the Connect wallet FROM the Paymax super-app wallet (the only
// funding rail). Amount entered in Naira, converted to kobo for the mutation.
const PRESETS_KOBO = [200_000, 500_000, 1_000_000, 2_500_000];

export default function FundWallet() {
  const summary = useWalletSummary();
  const fund = useFundWallet();
  // Stable across retries so a timeout replay is deduped, never double-posted.
  const { key: idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();
  const [naira, setNaira] = useState('');

  const amountKobo = useMemo(() => nairaStringToKobo(naira), [naira]);

  if (summary.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Fund wallet" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (summary.error || !summary.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Fund wallet" />
        <StateView kind="error" title="Couldn't load wallet" actionLabel="Retry" onAction={() => summary.refetch()} />
      </SafeAreaView>
    );
  }

  const { tier } = summary.data;
  const valid = amountKobo > 0;

  const onSubmit = () => {
    if (!valid) return;
    fund.mutate({ amountKobo, idempotencyKey }, {
      onSuccess: (r) => {
        resetIdempotencyKey();
        router.replace({ pathname: '/connect/wallet/transaction-detail', params: { id: r.entry.id } });
      },
      onError: (e: unknown) => {
        // A 409 means the first attempt already funded the wallet.
        if (isDuplicateReplay(e)) {
          resetIdempotencyKey();
          router.replace('/connect/wallet');
          return;
        }
        Alert.alert('Funding failed', moneyErrorMessage(e));
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Fund wallet" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.sourceCard}>
          <View style={styles.sourceIcon}><Wallet size={20} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sourceLabel}>From</Text>
            <Text style={styles.sourceValue}>Paymax super-app wallet</Text>
          </View>
        </View>

        <Text style={styles.label}>Amount (₦)</Text>
        <TextInputField
          value={naira}
          onChangeText={(t) => setNaira(sanitizeMoneyInput(t))}
          keyboardType="decimal-pad"
          placeholder="0"
          inputMode="decimal"
          maxLength={13}
        />

        <View style={styles.presets}>
          {PRESETS_KOBO.map((k) => (
            <Pressable key={k} style={styles.preset} onPress={() => setNaira(String(k / 100))}>
              <Text style={styles.presetText}>{formatKobo(k)}</Text>
            </Pressable>
          ))}
        </View>

        {valid ? (
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>You will add</Text>
            <MoneyAmount kobo={amountKobo} direction="credit" size="md" />
          </View>
        ) : null}

        <TierLimitBar tier={tier} />

        <View style={styles.note}>
          <Info size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.noteText}>
            Funds move from your Paymax wallet into Connect. Your tier sets how much you can spend
            per day — funding does not change your tier.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={valid ? `Fund ${formatKobo(amountKobo)}` : 'Enter an amount'}
          onPress={onSubmit}
          disabled={!valid}
          loading={fund.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  sourceCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm,
  },
  sourceIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  sourceLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sourceValue: { ...Typography.labelLg, color: Colors.onSurface },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  preset: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  presetText: { ...Typography.labelMd, color: Colors.onSurface },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  note: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
