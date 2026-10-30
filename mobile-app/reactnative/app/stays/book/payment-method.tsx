import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Wallet, CreditCard, Building2, Banknote, Check } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { startCardTopup, useGatewayCheckout, waitForTopup } from '@/features/payments';
import { useStaysStore } from '@/features/stays/store';
import { usePreviewBreakdown } from '@/features/stays/hooks';
import { StaysColors } from '@/features/stays/constants/stays.constants';
import type { PaymentMethod } from '@/features/stays/types';

const METHODS: { key: PaymentMethod; label: string; desc: string; icon: React.ComponentType<any>; multiNightOnly?: boolean }[] = [
  { key: 'wallet', label: 'Pay with wallet', desc: 'Instant, no card. Top up in-flow if needed.', icon: Wallet },
  { key: 'card', label: 'Card (Paystack)', desc: 'Pay securely by card, bank transfer or USSD.', icon: CreditCard },
  { key: 'pay_at_property', label: 'Pay at property', desc: 'Held in escrow from your wallet. Pay the hotel after inspection, or cancel for a full refund.', icon: Building2 },
  { key: 'deposit', label: 'Deposit + balance', desc: 'Pay one night now. The balance is due to the property.', icon: Banknote, multiNightOnly: true },
];

export default function PaymentMethodScreen() {
  const { draft, addOnKeys, promoCode, useLoyalty, paymentMethod, setPaymentMethod } = useStaysStore();
  const preview = usePreviewBreakdown(
    draft ? { draft, addOnKeys, promoCode, useLoyalty } : ({} as any),
    !!draft,
  );
  const gateway = useGatewayCheckout();
  const [cardError, setCardError] = useState<string | null>(null);

  const nights = draft?.nights ?? 0;
  const methods = METHODS.filter((m) => !m.multiNightOnly || nights > 1);

  // Card is the utility-billing pattern: the server starts the Paystack transaction, the
  // in-app checkout resumes it, and once the webhook has credited the wallet we go on to
  // confirm, which takes the booking amount from the wallet.
  const payByCard = () => {
    const total = preview.data?.totalKobo ?? 0;
    if (!draft || total <= 0) return;
    setCardError(null);
    gateway.start({
      domain: 'stays',
      initialize: () => startCardTopup(total, 'stays'),
      onResolved: async ({ reference }) => {
        const credited = await waitForTopup(reference);
        if (credited) router.replace('/stays/book/confirm');
        else setCardError('Your payment is still being confirmed. Check your wallet shortly, then continue.');
      },
    });
  };

  const next = () => {
    if (paymentMethod === 'card') return payByCard();
    if (paymentMethod === 'wallet') return router.push('/stays/book/wallet-pay');
    return router.push('/stays/book/deposit-terms');
  };

  const continueLabel =
    paymentMethod === 'card' ? 'Pay with Paystack'
      : paymentMethod === 'wallet' ? 'Continue to pay'
        : 'Review terms';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payment method" subtitle="Step 4 of 5" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {methods.map((m) => {
          const Icon = m.icon;
          const on = paymentMethod === m.key;
          return (
            <Pressable key={m.key} style={[styles.card, on && styles.cardOn]} onPress={() => setPaymentMethod(m.key)}>
              <View style={styles.iconBox}><Icon size={20} color={StaysColors.brand} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{m.label}</Text>
                <Text style={styles.desc}>{m.desc}</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
              </View>
            </Pressable>
          );
        })}

        <View style={styles.assure}>
          <Text style={styles.assureText}>
            Nothing is charged until the hotel confirms. If the booking fails, any hold is released automatically with no debit.
          </Text>
        </View>

        {cardError || gateway.error ? <Text style={styles.error}>{cardError ?? gateway.error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={continueLabel}
          onPress={next}
          loading={gateway.phase === 'initializing'}
          disabled={gateway.phase === 'initializing' || gateway.phase === 'awaiting'}
        />
      </View>

      {/* Hosts the in-app Paystack checkout on native (nothing on web). */}
      <gateway.Sheet />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, padding: Spacing.md },
  cardOn: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  assure: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  assureText: { ...Typography.bodySm, color: Colors.onSurface },
  error: { ...Typography.bodySm, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
