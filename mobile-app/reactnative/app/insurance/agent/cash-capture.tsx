import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Banknote, CircleCheck } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useCustomer, useCaptureCashToWallet } from '@/features/insurance/agent';
import { InsuranceColors, formatNaira } from '@/features/insurance/constants/insurance.constants';

/** Agent: cash-to-wallet premium capture (PRD §14.6 / §15.2). */
export default function CashCapture() {
  const { customerId, amount, quoteId } = useLocalSearchParams<{ customerId: string; amount?: string; quoteId?: string }>();
  const customer = useCustomer(customerId ?? '');
  const capture = useCaptureCashToWallet();
  const idemKey = useRef(`ins-cash-${customerId}-${Math.random().toString(36).slice(2, 10)}`).current;

  const presetNaira = amount ? String(Math.round(Number(amount) / 100)) : '';
  const [naira, setNaira] = useState(presetNaira);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState(false);

  if (customer.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Capture cash" />
        <StateView kind="loading" message="Loading customer…" />
      </SafeAreaView>
    );
  }
  if (customer.isError || !customer.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Capture cash" />
        <StateView kind="error" title="Customer not found" actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const cust = customer.data;

  const onCapture = async () => {
    setError(null);
    const n = Number(naira);
    if (!naira || Number.isNaN(n) || n <= 0) { setError('Enter a valid cash amount.'); return; }
    await capture.mutateAsync({ customerId: cust.id, amountKobo: Math.round(n * 100), idempotencyKey: idemKey });
    setCaptured(true);
  };

  if (captured) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Cash captured" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.heroIcon}><CircleCheck size={40} color={InsuranceColors.ok} strokeWidth={2} /></View>
          <Text style={styles.successTitle}>{formatNaira(Math.round(Number(naira) * 100))} added</Text>
          <Text style={styles.successSub}>Funds moved from your float to {cust.fullName}'s wallet.</Text>
        </View>
        <View style={styles.footer}>
          {quoteId ? (
            <PrimaryButton label="Continue to bind" onPress={() => router.replace(`/insurance/agent/assisted-bind?customerId=${cust.id}&quoteId=${quoteId}`)} />
          ) : (
            <PrimaryButton label="Done" onPress={() => router.replace('/insurance/agent/customer-lookup')} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Capture cash" subtitle={cust.fullName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Banknote size={28} color={InsuranceColors.brand} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>Cash → wallet</Text>
          <Text style={styles.heroSub}>Collect cash from the customer and credit their Paymax wallet from your agent float.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Current wallet balance</Text>
          <Text style={styles.balance}>{formatNaira(cust.walletKobo)}</Text>
        </View>

        <TextInputField
          label="Cash amount (₦)"
          value={naira}
          onChangeText={setNaira}
          placeholder="0"
          keyboardType="numeric"
        />
        {error ? <Text style={styles.err}>{error}</Text> : null}

        <Text style={styles.note}>This is an idempotent capture — submitting twice won't double-credit the wallet.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Capture cash" onPress={onCapture} loading={capture.isPending} />
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
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: 4 },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  balance: { ...Typography.titleLg, color: Colors.onSurface },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  err: { ...Typography.labelSm, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  successTitle: { ...Typography.titleLg, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
