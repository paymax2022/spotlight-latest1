import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useDues, usePayInvoice } from '@/features/association/hooks/useAssociation';
import { formatNaira } from '@/features/association/utils/associationFormatters';
import type { PayInvoiceResult } from '@/features/association/types/association.types';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';

export default function PayInvoiceScreen() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const dues = useDues();
  const pay = usePayInvoice();
  const checkout = usePurchasePayment<PayInvoiceResult>();

  const invoice = dues.data?.invoices.find((i) => i.id === invoiceId);

  if (dues.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Payment" />
        <StateView kind="loading" message="Loading invoice…" />
      </SafeAreaView>
    );
  }
  if (dues.isError || !invoice) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Payment" />
        <StateView kind="error" title="Invoice unavailable" message="We couldn't find this invoice." actionLabel="Back to dues" onAction={() => router.replace('/association/dues')} />
      </SafeAreaView>
    );
  }

  const onPay = () => {
    checkout.start({
      amountKobo: invoice.amountKobo,
      title: invoice.title,
      charge: () => pay.mutateAsync({ invoiceId: invoice.id, method: 'WALLET' }),
      onPaid: (res) => {
        if (res.status === 'SUCCESS') router.replace(`/association/receipt/${res.receiptId}`);
        else if (res.status === 'PENDING') router.replace('/association/edge/payment-required');
        else Alert.alert('Payment failed', 'Your payment could not be completed. Please try again.');
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payment" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Invoice summary */}
        <View style={[styles.card, shadow1]}>
          <Text style={styles.invTitle}>{invoice.title}</Text>
          {invoice.description ? <Text style={styles.invSub}>{invoice.description}</Text> : null}
          <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>Amount due</Text>
            <Text style={styles.amount}>{formatNaira(invoice.amountKobo)}</Text>
          </View>
        </View>

        {/* Revenue split explainer */}
        <View style={styles.splitCard}>
          <Text style={styles.splitTitle}>Where your dues go</Text>
          {[
            { label: 'National body', pct: 0.5 },
            { label: 'State chapter', pct: 0.3 },
            { label: 'Local chapter', pct: 0.15 },
            { label: 'Platform fee', pct: 0.05 },
          ].map((s) => (
            <View key={s.label} style={styles.splitRow}>
              <Text style={styles.splitLabel}>{s.label}</Text>
              <Text style={styles.splitValue}>{formatNaira(Math.round(invoice.amountKobo * s.pct))}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={`Pay ${formatNaira(invoice.amountKobo)}`} onPress={onPay} loading={pay.isPending} />
      </View>
      <PaymentSheet controller={checkout} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
    marginHorizontal: Spacing.containerMargin, gap: 4,
  },
  invTitle: { ...Typography.titleMd, color: Colors.onSurface },
  invSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  amountLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amount: { ...Typography.headlineMd, color: Colors.onSurface },
  splitCard: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, marginHorizontal: Spacing.containerMargin, gap: 6,
  },
  splitTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: 2 },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between' },
  splitLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  splitValue: { ...Typography.labelSm, color: Colors.onSurface },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
});
