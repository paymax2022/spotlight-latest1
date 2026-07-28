import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Banknote, Link2, Wallet, Check, Copy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useQuote, useCustomer, useCollectPayment, type CollectMethod } from '@/features/stays/agent';
import { formatNaira, StaysColors } from '@/features/stays/constants/stays.constants';

const METHODS: { key: CollectMethod; icon: React.ReactNode; title: string; sub: string }[] = [
  { key: 'cash_float', icon: <Banknote size={20} color={Colors.primary} />, title: 'Cash → agent float → wallet', sub: 'Collect cash; fund the customer wallet from your float.' },
  { key: 'pay_link', icon: <Link2 size={20} color={Colors.primary} />, title: 'Send pay link', sub: 'Customer settles the booking link themselves.' },
  { key: 'customer_wallet', icon: <Wallet size={20} color={Colors.primary} />, title: "Charge customer wallet", sub: 'Use the balance already on the customer wallet.' },
];

/** Agent: collect payment (PRD §20.5). */
export default function CollectPaymentScreen() {
  const { quoteId, customerId } = useLocalSearchParams<{ quoteId: string; customerId: string }>();
  const quote = useQuote(quoteId ?? '');
  const customer = useCustomer(customerId ?? '');
  const collectM = useCollectPayment();
  const [method, setMethod] = useState<CollectMethod>('cash_float');
  const [payLink, setPayLink] = useState<string | null>(null);

  if (quote.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Collect payment" />
        <StateView kind="loading" message="Loading quote…" />
      </SafeAreaView>
    );
  }
  if (quote.isError || !quote.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Collect payment" />
        <StateView kind="error" icon="Clock" title="Quote expired" message="Build a new quote to continue." actionLabel="Find customer" onAction={() => router.replace('/stays/agent/customer-lookup')} />
      </SafeAreaView>
    );
  }

  const q = quote.data;
  const walletShort = (customer.data?.walletKobo ?? 0) < q.totalKobo;

  function collect() {
    if (!quoteId) return;
    collectM.mutate(
      { quoteId, method },
      {
        onSuccess: (res) => {
          if (res.method === 'pay_link') {
            setPayLink(res.payLink ?? null);
          } else {
            router.push({ pathname: '/stays/agent/confirm', params: { quoteId, customerId } });
          }
        },
      },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Collect payment" subtitle={customer.data?.fullName} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>Amount to collect</Text>
          <Text style={styles.amount}>{formatNaira(q.totalKobo)}</Text>
        </View>

        {METHODS.map((m) => {
          const active = method === m.key;
          const disabled = m.key === 'customer_wallet' && walletShort;
          return (
            <Pressable
              key={m.key}
              style={[styles.method, active && styles.methodActive, disabled && styles.methodDim]}
              onPress={() => !disabled && setMethod(m.key)}
              disabled={disabled}
            >
              <View style={styles.methodIcon}>{m.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodTitle}>{m.title}</Text>
                <Text style={styles.methodSub}>{disabled ? 'Insufficient wallet balance' : m.sub}</Text>
              </View>
              <View style={[styles.radio, active && styles.radioOn]}>{active ? <Check size={12} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
            </Pressable>
          );
        })}

        {payLink ? (
          <View style={styles.linkCard}>
            <Text style={styles.linkLabel}>Pay link sent</Text>
            <View style={styles.linkRow}>
              <Text style={styles.linkUrl} numberOfLines={1}>{payLink}</Text>
              <Copy size={16} color={Colors.primary} />
            </View>
            <Text style={styles.linkNote}>Once the customer pays, confirm the booking.</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {payLink ? (
          <PrimaryButton label="Confirm booking" onPress={() => router.push({ pathname: '/stays/agent/confirm', params: { quoteId, customerId } })} />
        ) : (
          <PrimaryButton
            label={collectM.isPending ? 'Collecting…' : method === 'pay_link' ? 'Send pay link' : 'Collect & continue'}
            loading={collectM.isPending}
            onPress={collect}
          />
        )}
        {collectM.isError ? <Text style={styles.err}>Couldn't collect payment. Please try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  amountCard: { backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center', gap: 2 },
  amountLabel: { ...Typography.labelMd, color: Colors.onPrimary },
  amount: { ...Typography.headlineMd, color: Colors.onPrimary, fontWeight: '800' as const },
  method: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  methodActive: { borderColor: Colors.primary },
  methodDim: { opacity: 0.5 },
  methodIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  methodTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  methodSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  linkCard: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  linkLabel: { ...Typography.labelLg, color: StaysColors.ok, fontWeight: '700' as const },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, padding: Spacing.sm },
  linkUrl: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  linkNote: { ...Typography.caption, color: Colors.onSurface },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm, ...shadow2 },
  err: { ...Typography.caption, color: Colors.error, textAlign: 'center' },
});
