import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import PaymentMethodSelector, { PaymentMethod } from '@/components/PaymentMethodSelector';
import DetailRow from '@/features/realtor/components/DetailRow';
import { useLease, useInvoice, usePayInvoice } from '@/features/realtor/hooks/useRealtorLease';
import { formatNaira } from '@/features/realtor/utils/realtorFormatters';

const MOCK_WALLET_NAIRA = 9_000_000; // demo wallet balance

export default function LeasePayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lease = useLease(String(id));
  const invoice = useInvoice(lease.data?.invoiceId ?? '');
  const pay = usePayInvoice();
  const [method, setMethod] = useState<PaymentMethod>('WALLET');
  const [error, setError] = useState<string>();

  const submit = async () => {
    if (!invoice.data) return;
    setError(undefined);
    try {
      const receipt = await pay.mutateAsync({ invoiceId: invoice.data.id, channel: method });
      router.replace(`/realtor/lease/${id}/paid?ref=${receipt.reference}`);
    } catch {
      setError('Payment failed. Please try again or use another method.');
    }
  };

  if (lease.isLoading || invoice.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pay rent & deposit" />
        <StateView kind="loading" message="Loading your invoice…" />
      </SafeAreaView>
    );
  }
  if (!invoice.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pay rent & deposit" />
        <StateView kind="error" title="Invoice not ready" message="Sign the lease first to generate your invoice." actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const inv = invoice.data;
  const deposit = inv.lines.filter((l) => l.refundable).reduce((s, l) => s + l.amount, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pay rent & deposit" subtitle={inv.listingTitle} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          {inv.lines.map((l) => (
            <DetailRow key={l.label} label={l.label} value={formatNaira(l.amount)} refundable={l.refundable} />
          ))}
          <View style={styles.divider} />
          <DetailRow label="Total due" value={formatNaira(inv.total)} emphasis />
        </View>

        {deposit > 0 ? (
          <View style={styles.escrowNote}>
            <ShieldCheck size={14} color={Colors.tertiaryContainer} strokeWidth={2.2} />
            <Text style={styles.escrowText}>
              {formatNaira(deposit)} of this is your refundable caution deposit — it goes straight into escrow, not to the landlord.
            </Text>
          </View>
        ) : null}

        <View style={styles.methodWrap}>
          <PaymentMethodSelector
            selected={method}
            onSelect={setMethod}
            walletBalance={MOCK_WALLET_NAIRA}
            amount={inv.total / 100}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label={`Pay ${formatNaira(inv.total)}`} onPress={submit} loading={pay.isPending} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  escrowNote: {
    flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md,
  },
  escrowText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  methodWrap: { marginTop: Spacing.lg },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest,
  },
});
