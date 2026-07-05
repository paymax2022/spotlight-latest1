import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet, Check } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useCoverOffer, useBindEmbeddedCover } from '@/features/insurance/embedded';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import type { BindEmbeddedResult } from '@/features/insurance/embedded';

/** Wallet-insurance opt-in (PRD §15.1). Voluntary cover; binds via PaymentSheet. */
export default function WalletOptIn() {
  const offer = useCoverOffer('wallet');
  const bind = useBindEmbeddedCover();
  const pay = usePurchasePayment<BindEmbeddedResult>();
  const [submitting, setSubmitting] = useState(false);
  const idemKey = useRef(`ins-optin-wallet-${Math.random().toString(36).slice(2, 10)}`).current;

  if (offer.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Wallet Protection" />
        <StateView kind="loading" message="Loading cover…" />
      </SafeAreaView>
    );
  }
  if (offer.isError || !offer.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Wallet Protection" />
        <StateView kind="error" title="Cover unavailable" message="Please try again shortly." actionLabel="Retry" onAction={() => offer.refetch()} />
      </SafeAreaView>
    );
  }

  const o = offer.data;
  const insured = o.status === 'INSURED';

  const onProtect = () => {
    setSubmitting(true);
    pay.start({
      amountKobo: o.premiumKobo,
      title: `Activate ${o.productName}`,
      charge: async () => {
        const res = await bind.mutateAsync({ sourceEventId: o.sourceEventId, idempotencyKey: idemKey });
        if (!res.ok) throw new Error(res.errorMessage ?? 'Could not activate cover. Your wallet was not charged.');
        return res;
      },
      onPaid: (res) => { if (res.ok && res.policy) router.replace(`/insurance/policies/${res.policy.id}`); },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Wallet Protection" subtitle="Opt-in cover" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Wallet size={28} color={InsuranceColors.brand} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>Protect your wallet balance</Text>
          <Text style={styles.heroSub}>Cover against fraud and unauthorised transactions on your Paymax wallet.</Text>
        </View>

        <UnderwriterBadge disclosure={o.disclosure} />

        <View style={styles.card}>
          {o.benefits.map((b) => (
            <View key={b} style={styles.benefit}>
              <Check size={16} color={InsuranceColors.ok} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <PremiumRow label="Cover (sum insured)" amountKobo={o.sumInsuredKobo} />
          <PremiumRow label="Premium" amountKobo={o.premiumKobo} cadence={o.premiumCadence} emphasis />
        </View>

        <Text style={styles.note}>
          Voluntary cover. Premium is debited from your wallet and passed through to the underwriter; Paymax earns only a distribution commission. Cancel anytime.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        {insured ? (
          <PrimaryButton label="You're protected — view policy" onPress={() => router.replace(`/insurance/policies/${o.policyId}`)} />
        ) : (
          <PrimaryButton label="Activate protection" onPress={onProtect} loading={submitting && pay.visible} />
        )}
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
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  benefitText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
