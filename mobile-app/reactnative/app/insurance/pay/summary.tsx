import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useQuote, useBindPolicy } from '@/features/insurance/hooks';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import type { BindResult } from '@/features/insurance/types';

export default function PaySummary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const quote = useQuote(id ?? '');
  const bind = useBindPolicy();
  const pay = usePurchasePayment<BindResult>();
  const [submitting, setSubmitting] = useState(false);

  // Stable idempotency key for this bind attempt (PRD §11 — bind is idempotent).
  const idemKey = useRef(`ins-bind-${id}-${Math.random().toString(36).slice(2, 10)}`).current;

  if (quote.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Premium summary" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (quote.isError || !quote.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Premium summary" />
        <StateView kind="error" title="Quote unavailable" actionLabel="Start over" onAction={() => router.replace('/insurance/browse')} />
      </SafeAreaView>
    );
  }

  const q = quote.data;

  // Debit→bind saga: the shared payments controller guarantees funds, then the
  // "charge" binds with the provider. On bind FAILURE the premium is auto-reversed
  // to wallet and we route to the failure screen (PRD §10.1 — the key invariant).
  const onPay = () => {
    setSubmitting(true);
    pay.start({
      amountKobo: q.premiumKobo,
      title: `Pay premium · ${q.productName}`,
      charge: async () => {
        const res = await bind.mutateAsync({ quoteId: q.id, idempotencyKey: idemKey });
        if (!res.ok) {
          // Surface a thrown error so the sheet shows it; then route to failure.
          const refund = res.autoRefundKobo ?? q.premiumKobo;
          router.replace(
            `/insurance/pay/failure?reason=${encodeURIComponent(res.errorMessage ?? 'Binding failed.')}&refund=${refund}`,
          );
          throw new Error(res.errorMessage ?? 'Binding failed — your premium was refunded.');
        }
        return res;
      },
      onPaid: (res) => {
        if (res.ok && res.policy) {
          router.replace(`/insurance/pay/success?policyId=${res.policy.id}`);
        }
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Premium summary" subtitle={q.productName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><ShieldCheck size={26} color={InsuranceColors.brand} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>You're almost protected</Text>
          <Text style={styles.heroSub}>Review and pay your premium to activate cover.</Text>
        </View>

        <UnderwriterBadge disclosure={q.disclosure} />

        <View style={styles.card}>
          <PremiumRow label="Product" value={q.productName} />
          <PremiumRow label="Cover (sum insured)" amountKobo={q.sumInsuredKobo} />
          <PremiumRow label="Premium due" amountKobo={q.premiumKobo} cadence={q.premiumCadence} emphasis />
        </View>

        <Text style={styles.note}>
          Your premium is debited from your wallet (or card) and passed through to the underwriter.
          If binding fails for any reason, your premium is automatically refunded to your wallet.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Pay & activate cover" onPress={onPay} loading={submitting && pay.visible} />
      </View>

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
