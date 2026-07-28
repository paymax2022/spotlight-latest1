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
import { useBeneficiaries } from '@/features/fx/hooks/useFx';
import { buildQuote, maskAccount } from '@/features/fx/utils/fxFormatters';
import { RAIL_LABEL } from '@/features/fx/constants/fx.constants';
import type { CurrencyCode, Quote } from '@/features/fx/types/fx.types';

export default function SendReviewScreen() {
  const p = useLocalSearchParams<{ beneficiaryId: string; source: string; amount: string; narration: string }>();
  const { data: beneficiaries, isLoading } = useBeneficiaries();
  const beneficiary = beneficiaries?.find((b) => b.id === p.beneficiaryId);
  const source = p.source as CurrencyCode;
  const amount = Number(p.amount);

  const makeQuote = useCallback((): Quote | null => {
    if (!beneficiary) return null;
    return buildQuote({
      source, destination: beneficiary.currency, amount, amountType: 'source',
      intent: 'transfer', destinationRail: beneficiary.rail, lock: true,
    });
  }, [beneficiary, source, amount]);

  const [quote, setQuote] = useState<Quote | null>(makeQuote);
  const [expired, setExpired] = useState(false);

  // Initialize quote once beneficiary resolves (async list load).
  React.useEffect(() => { if (!quote && beneficiary) setQuote(makeQuote()); }, [beneficiary, quote, makeQuote]);

  if (isLoading || !beneficiary || !quote) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Review payout" /><StateView kind="loading" /></SafeAreaView>;
  }

  const reQuote = () => { setQuote(makeQuote()); setExpired(false); };

  const authorize = () => {
    if (expired) { reQuote(); return; }
    router.push({
      pathname: '/fx/send/processing',
      params: { beneficiaryId: beneficiary.id, source, amount: String(amount), narration: p.narration ?? '', expiresAt: quote.expiresAt },
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
