import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { formatNaira } from '@/features/academy/constants';
import { PAYMENT_METHODS } from '@/features/academy/fees/constants';
import { useInvoice, usePayInvoice } from '@/features/academy/fees/hooks';
import type { PayMethod } from '@/features/academy/fees/types';

/** PA-05 — Pay now: amount (full or partial) + method, wired to the idempotent pay mutation. */
export default function PayInvoice() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const invoice = useInvoice(invoiceId);
  const pay = usePayInvoice();
  const [method, setMethod] = useState<PayMethod>('wallet');
  const [amountNaira, setAmountNaira] = useState('');

  if (invoice.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pay fees" />
        <StateView kind="loading" message="Loading invoice…" />
      </SafeAreaView>
    );
  }
  if (!invoice.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pay fees" />
        <StateView kind="error" title="Invoice not found" actionLabel="Go back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const inv = invoice.data;
  const outstanding = inv.totalKobo - inv.paidKobo;
  const amountKobo = Math.round((parseFloat(amountNaira) || 0) * 100);
  const useFull = amountNaira.trim() === '';
  const chargeKobo = useFull ? outstanding : amountKobo;
  const invalid = chargeKobo <= 0 || chargeKobo > outstanding;

  const onPay = () => {
    if (invalid) return;
    pay.mutate(
      { invoiceId: inv.id, amountKobo: chargeKobo, method },
      {
        onSuccess: (res) => {
          if (res.status === 'paid') {
            Alert.alert('Payment successful', `${formatNaira(res.amountKobo)} paid. New balance: ${formatNaira(res.newBalanceKobo)}.`, [
              { text: 'View receipt', onPress: () => router.replace('/learn/academy/fees/receipts') },
              { text: 'Done', onPress: () => router.replace(`/learn/academy/fees/invoice/${inv.id}`), style: 'cancel' },
            ]);
          } else {
            Alert.alert('Complete payment', 'You will be redirected to secure checkout to finish this payment.', [
              { text: 'OK', onPress: () => router.replace(`/learn/academy/fees/invoice/${inv.id}`) },
            ]);
          }
        },
        onError: (e) => Alert.alert('Payment failed', (e as Error).message),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pay fees" subtitle={inv.reference} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, shadow1]}>
          <Text style={styles.school}>{inv.schoolName}</Text>
          <Text style={styles.sub}>{inv.childName} · {inv.term}</Text>
          <Text style={styles.outLabel}>Outstanding</Text>
          <Text style={styles.out}>{formatNaira(outstanding)}</Text>
        </View>

        {/* Amount */}
        <Text style={styles.section}>Amount</Text>
        <TextInputField
          placeholder={`Full balance (${formatNaira(outstanding)})`}
          value={amountNaira}
          onChangeText={setAmountNaira}
          keyboardType="numeric"
          leftIcon={<Text style={styles.naira}>₦</Text>}
        />
        <View style={styles.chipRow}>
          {[25, 50, 100].map((p) => (
            <Pressable key={p} style={styles.pctChip} onPress={() => setAmountNaira(String(Math.round((outstanding * (p / 100)) / 100)))}>
              <Text style={styles.pctText}>{p === 100 ? 'Full' : `${p}%`}</Text>
            </Pressable>
          ))}
        </View>
        {chargeKobo > outstanding ? <Text style={styles.err}>Amount exceeds the outstanding balance.</Text> : null}

        {/* Method */}
        <Text style={styles.section}>Payment method</Text>
        {PAYMENT_METHODS.map((m) => {
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Wallet;
          const active = method === m.value;
          return (
            <Pressable key={m.value} style={[styles.method, shadow1, active && styles.methodActive]} onPress={() => setMethod(m.value)}>
              <View style={[styles.methodIcon, active && { backgroundColor: Colors.primary }]}>
                <Icon size={18} color={active ? Colors.onPrimary : Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodLabel}>{m.label}</Text>
                <Text style={styles.methodHint}>{m.hint}</Text>
              </View>
              {active ? <CheckCircle2 size={18} color={Colors.primary} /> : <View style={styles.radio} />}
            </Pressable>
          );
        })}

        <PrimaryButton
          label={`Pay ${formatNaira(chargeKobo)}`}
          onPress={onPay}
          loading={pay.isPending}
          disabled={invalid}
          style={{ marginTop: Spacing.md }}
        />
        <Text style={styles.note}>Every payment posts to a balanced ledger and returns a receipt. Amounts are in Naira.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  school: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  outLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  out: { ...Typography.headlineMd, color: Colors.error },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md },
  naira: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  chipRow: { flexDirection: 'row', gap: Spacing.sm },
  pctChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  pctText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '700' },
  err: { ...Typography.bodySm, color: Colors.error },
  method: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.transparent },
  methodActive: { borderColor: Colors.primary },
  methodIcon: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  methodLabel: { ...Typography.labelLg, color: Colors.onSurface },
  methodHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  radio: { width: 18, height: 18, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outlineVariant },
  note: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
});
