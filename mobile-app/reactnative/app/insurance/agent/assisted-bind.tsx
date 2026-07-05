import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, CircleCheck } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useQuote } from '@/features/insurance/hooks';
import { useCustomer, useAssistedBind } from '@/features/insurance/agent';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';

/** Agent: assisted bind — policy attaches to the CUSTOMER (PRD §14.6 / §15.2). */
export default function AssistedBind() {
  const { customerId, quoteId } = useLocalSearchParams<{ customerId: string; quoteId: string }>();
  const quote = useQuote(quoteId ?? '');
  const customer = useCustomer(customerId ?? '');
  const bind = useAssistedBind();
  const idemKey = useRef(`ins-abind-${quoteId}-${Math.random().toString(36).slice(2, 10)}`).current;
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (quote.isLoading || customer.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Confirm & bind" />
        <StateView kind="loading" message="Loading quote…" />
      </SafeAreaView>
    );
  }
  if (quote.isError || !quote.data || customer.isError || !customer.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Confirm & bind" />
        <StateView kind="error" title="Quote unavailable" actionLabel="Start over" onAction={() => router.replace('/insurance/agent/customer-lookup')} />
      </SafeAreaView>
    );
  }

  const q = quote.data;
  const cust = customer.data;
  const insufficient = cust.walletKobo < q.premiumKobo;

  const onBind = async () => {
    setError(null);
    const res = await bind.mutateAsync({ customerId: cust.id, quoteId: q.id, idempotencyKey: idemKey });
    if (!res.ok) {
      setError(res.errorMessage ?? 'Could not bind. Please try again.');
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Policy bound" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.heroIcon}><CircleCheck size={40} color={InsuranceColors.ok} strokeWidth={2} /></View>
          <Text style={styles.successTitle}>Cover activated</Text>
          <Text style={styles.successSub}>{q.productName} is now active for {cust.fullName}. The policy is issued to the customer's identity.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="View agent book" onPress={() => router.replace('/insurance/agent/book')} />
          <Text style={styles.link} onPress={() => router.replace('/insurance/agent/customer-lookup')}>Sell another policy</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Confirm & bind" subtitle={cust.fullName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><ShieldCheck size={26} color={InsuranceColors.brand} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>Review and bind</Text>
        </View>

        <UnderwriterBadge disclosure={q.disclosure} />

        <View style={styles.card}>
          <PremiumRow label="Policyholder" value={cust.fullName} />
          <PremiumRow label="Product" value={q.productName} />
          <PremiumRow label="Cover (sum insured)" amountKobo={q.sumInsuredKobo} />
          <PremiumRow label="Customer wallet" amountKobo={cust.walletKobo} />
          <PremiumRow label="Premium due" amountKobo={q.premiumKobo} cadence={q.premiumCadence} emphasis />
        </View>

        {insufficient ? (
          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>Insufficient wallet balance</Text>
            <Text style={styles.warnText}>The customer's wallet can't cover the premium. Capture cash to top up their wallet first.</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Text style={styles.note}>Premium is debited from the customer's wallet and passed through to the underwriter. The policy attaches to the customer, not your agent account.</Text>
      </ScrollView>

      <View style={styles.footer}>
        {insufficient ? (
          <PrimaryButton
            label="Capture cash to wallet"
            onPress={() => router.push(`/insurance/agent/cash-capture?customerId=${cust.id}&amount=${q.premiumKobo}&quoteId=${q.id}`)}
          />
        ) : (
          <PrimaryButton label="Bind policy" onPress={onBind} loading={bind.isPending} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  warnBox: { backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md, gap: 4 },
  warnTitle: { ...Typography.labelLg, color: Colors.onWarning },
  warnText: { ...Typography.bodySm, color: Colors.onSurface },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  err: { ...Typography.labelSm, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.sm },
  link: { ...Typography.labelLg, color: InsuranceColors.brand, textAlign: 'center' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  successTitle: { ...Typography.titleLg, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
