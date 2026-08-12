import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Fingerprint } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import QuoteBreakdown from '@/features/fx/components/QuoteBreakdown';
import RateLockCountdown from '@/features/fx/components/RateLockCountdown';
import SummaryRow from '@/features/fx/components/SummaryRow';
import { useBeneficiaries, useCreateQuote } from '@/features/fx/hooks/useFx';
import { maskAccount } from '@/features/fx/utils/fxFormatters';
import { RAIL_LABEL } from '@/features/fx/constants/fx.constants';
import type { CurrencyCode } from '@/features/fx/types/fx.types';

export default function SendReviewScreen() {
  const p = useLocalSearchParams<{ beneficiaryId: string; source: string; amount: string; narration: string }>();
  const { data: beneficiaries, isLoading } = useBeneficiaries();
  const beneficiary = beneficiaries?.find((b) => b.id === p.beneficiaryId);
  const source = p.source as CurrencyCode;
  const amount = Number(p.amount);

  // Server-priced quote (quote → lock → execute): the backend prices the
  // corridor, picks the provider route, and returns the lock window. The
  // all-in cost shown below is the number the payout will execute at.
  const createQuote = useCreateQuote();
  const quote = createQuote.data ?? null;
  const [expired, setExpired] = useState(false);

  const requestQuote = useCallback(() => {
    if (!beneficiary) return;
    setExpired(false);
    createQuote.mutate({
      source, destination: beneficiary.currency, amount, amountType: 'source',
      intent: 'transfer', destinationRail: beneficiary.rail, lock: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiary?.id, source, amount]);

  // Price once the beneficiary resolves (async list load).
  React.useEffect(() => { if (beneficiary && !quote && !createQuote.isPending && !createQuote.isError) requestQuote(); }, [beneficiary, quote, createQuote.isPending, createQuote.isError, requestQuote]);

  if (createQuote.isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScreenHeader title="Review payout" />
        <StateView
          kind="error"
          title="Couldn't price this payout"
          message={(createQuote.error as Error | null)?.message ?? 'The rate service is unavailable. Try again.'}
          actionLabel="Retry"
          onAction={requestQuote}
        />
      </SafeAreaView>
    );
  }

  if (isLoading || !beneficiary || !quote) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Review payout" /><StateView kind="loading" /></SafeAreaView>;
  }

  const reQuote = () => requestQuote();

  const authorize = () => {
    if (expired) { reQuote(); return; }
    router.push({
      pathname: '/fx/send/processing',
      params: { beneficiaryId: beneficiary.id, source, amount: String(amount), narration: p.narration ?? '', quote: JSON.stringify(quote) },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review payout" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <RateLockCountdown expiresAt={quote.expiresAt} onExpire={() => setExpired(true)} />

        <View style={styles.card}>
          <SummaryRow label="Beneficiary" value={beneficiary.name} emphasis />
          <View style={styles.divider} />
          <SummaryRow label="Rail" value={RAIL_LABEL[beneficiary.rail]} />
          <SummaryRow label={beneficiary.bankName ? 'Institution' : 'Destination'} value={beneficiary.bankName ?? RAIL_LABEL[beneficiary.rail]} />
          <SummaryRow label="Account" value={maskAccount(beneficiary.accountNumber)} copyable />
          {p.narration ? <SummaryRow label="Narration" value={p.narration} /> : null}
        </View>

        <Text style={styles.sectionLabel}>All-in cost</Text>
        <QuoteBreakdown quote={quote} showRoute />
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {expired ? (
          <PrimaryButton label="Rate expired — get new quote" onPress={reQuote} />
        ) : (
          <PrimaryButton
            label="Authorize with biometrics"
            onPress={authorize}
            style={styles.authBtn}
          />
        )}
        {!expired ? (
          <View style={styles.authHint}>
            <Fingerprint size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.authHintText}>You'll confirm with Face ID / fingerprint to send.</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },
  authBtn: {},
  authHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  authHintText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
