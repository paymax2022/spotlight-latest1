import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { CheckCircle2, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useStock, useInvestWallet, useBuyOrder } from '@/features/invest/hooks/useInvest';
import { formatNaira, nairaToKobo, formatQty, orderStatusLabel } from '@/features/invest/utils/format';
import type { Receipt } from '@/features/invest/types/invest.types';
import { confirmAsync, alertAsync } from '@/lib/confirm';

// Estimated commission for DISPLAY only — the server recomputes and is the
// source of truth (iron rule: never trust client-side fee calc).
const EST_COMMISSION_BPS = 150;
const EST_MIN_FEE_KOBO = 10_000;
function estFee(notional: number) {
  return Math.max(Math.round((notional * EST_COMMISSION_BPS) / 10_000), EST_MIN_FEE_KOBO);
}

export default function BuyScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const sym = String(symbol);
  const stock = useStock(sym);
  const wallet = useInvestWallet();
  const buy = useBuyOrder();

  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const price = stock.data?.quote.price_kobo ?? 0;
  const amountKobo = nairaToKobo(amount);
  const fee = useMemo(() => estFee(amountKobo), [amountKobo]);
  const total = amountKobo + fee;
  const estQty = price > 0 ? amountKobo / price : 0;
  const cash = wallet.data?.available_cash_kobo ?? 0;
  const min = stock.data?.minimum_order_amount ?? 0;

  const tooLow = amountKobo > 0 && amountKobo < min;
  const insufficient = total > cash;
  const pinValid = /^\d{4,6}$/.test(pin);
  const canSubmit = amountKobo > 0 && !tooLow && !insufficient && pinValid && !buy.isPending;

  async function onConfirm() {
    try {
      const res = await buy.mutateAsync({ symbol: sym, order_type: 'market', amount_kobo: amountKobo, pin });
      setReceipt(res);
    } catch (e: any) {
      const code = e?.response?.data?.code;
      if (code === 'pin_not_set') {
        const ok = await confirmAsync({ title: 'Set a transaction PIN', message: 'You need a transaction PIN before you can trade.', confirmLabel: 'Set PIN' });
        if (ok) router.push('/invest/security/pin');
        return;
      }
      const msg = e?.response?.data?.error ?? 'Your order could not be placed. Any locked cash has been released.';
      alertAsync({ title: 'Order failed', message: msg });
    }
  }

  if (stock.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={`Buy ${sym}`} />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (receipt) {
    const o = receipt.order;
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Order placed" showBack={false} />
        <ScrollView contentContainerStyle={styles.successWrap}>
          <View style={styles.successIcon}><CheckCircle2 size={56} color={Colors.teal} /></View>
          <Text style={styles.successTitle}>Buy order {orderStatusLabel(o.status).toLowerCase()}</Text>
          <Text style={styles.successSub}>{receipt.settlement_note}</Text>
          <View style={[styles.reviewCard, shadow1, { marginTop: Spacing.lg }]}>
            <Row label="Stock" value={o.symbol} />
            <Row label="Estimated units" value={formatQty(o.filled_quantity || o.quantity)} />
            <Row label="Price" value={formatNaira(o.executed_price_kobo || o.estimated_price_kobo)} />
            <Row label="Fees" value={formatNaira(o.fees_kobo)} />
            <Row label="Total debit" value={formatNaira(o.total_amount_kobo)} strong />
          </View>
          <Text style={styles.disclaimer}>{receipt.risk_disclosure}</Text>
          <PrimaryButton label="Done" onPress={() => router.replace('/invest')} style={{ marginTop: Spacing.lg }} />
          <PrimaryButton label="View orders" variant="ghost" onPress={() => router.replace('/invest/orders')} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Buy ${sym}`} subtitle={stock.data?.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxl }} keyboardShouldPersistTaps="handled">
        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>Amount to invest</Text>
          <View style={styles.amountInputRow}>
            <Text style={styles.currency}>₦</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={Colors.outline}
              keyboardType="decimal-pad"
              style={styles.amountInput}
              autoFocus
            />
          </View>
          <Text style={styles.cashHint}>Available cash: {formatNaira(cash)}</Text>
          {tooLow && <Text style={styles.err}>Minimum order is {formatNaira(min)}.</Text>}
          {insufficient && <Text style={styles.err}>Not enough cash. Add funds in your invest wallet.</Text>}
        </View>

        <View style={[styles.reviewCard, shadow1]}>
          <Row label="Market price" value={formatNaira(price)} />
          <Row label="Estimated units" value={formatQty(estQty)} />
          <Row label="Estimated fees" value={formatNaira(fee)} />
          <View style={styles.divider} />
          <Row label="Total debit" value={formatNaira(total)} strong />
          <Text style={styles.estNote}>Final price &amp; fees are confirmed by the server at execution.</Text>
        </View>

        <View style={styles.pinBlock}>
          <View style={styles.pinHeader}>
            <Lock size={16} color={Colors.onSurfaceVariant} />
            <Text style={styles.pinLabel}>Enter your PIN to confirm</Text>
          </View>
          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/[^0-9]/g, '').slice(0, 6))}
            placeholder="••••"
            placeholderTextColor={Colors.outline}
            keyboardType="number-pad"
            secureTextEntry
            style={styles.pinInput}
            maxLength={6}
          />
        </View>

        <Text style={styles.disclaimer}>
          Stock prices can rise or fall. You may get back less than you invest. This is not financial advice.
        </Text>

        <View style={{ paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md }}>
          <PrimaryButton label={buy.isPending ? 'Placing order…' : `Buy ${sym}`} onPress={onConfirm} loading={buy.isPending} disabled={!canSubmit} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && { color: Colors.onSurface }]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  amountBlock: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md, alignItems: 'center' },
  amountLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  amountInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.sm },
  currency: { ...Typography.headlineLg, color: Colors.onSurface },
  amountInput: { ...Typography.displayLg, fontSize: 44, color: Colors.onSurface, minWidth: 120, textAlign: 'center', padding: 0 },
  cashHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  err: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  reviewCard: {
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface },
  rowValueStrong: { ...Typography.titleMd, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.xs },
  estNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  pinBlock: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
  pinHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.sm },
  pinLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  pinInput: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, height: 56,
    ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center', letterSpacing: 8,
  },
  disclaimer: {
    ...Typography.labelSm, color: Colors.onSurfaceVariant,
    paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, fontStyle: 'italic',
  },
  successWrap: { alignItems: 'center', padding: Spacing.containerMargin, paddingTop: Spacing.xl },
  successIcon: { marginBottom: Spacing.md },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
});
