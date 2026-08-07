import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
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
import { useStock, usePortfolio, useSellOrder } from '@/features/invest/hooks/useInvest';
import { formatNaira, formatQty, orderStatusLabel } from '@/features/invest/utils/format';
import type { Receipt } from '@/features/invest/types/invest.types';
import { confirmAsync, alertAsync } from '@/lib/confirm';

const EST_COMMISSION_BPS = 150;
const EST_MIN_FEE_KOBO = 10_000;
const estFee = (n: number) => Math.max(Math.round((n * EST_COMMISSION_BPS) / 10_000), EST_MIN_FEE_KOBO);

export default function SellScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const sym = String(symbol);
  const stock = useStock(sym);
  const portfolio = usePortfolio();
  const sell = useSellOrder();

  const [qty, setQty] = useState('');
  const [pin, setPin] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const position = (portfolio.data?.positions ?? []).find((p) => p.symbol === sym);
  const available = position?.available_quantity ?? 0;
  const price = stock.data?.quote.price_kobo ?? 0;
  const sellQty = parseFloat(qty.replace(/[^0-9.]/g, '')) || 0;
  const gross = Math.round(sellQty * price);
  const fee = useMemo(() => (gross > 0 ? estFee(gross) : 0), [gross]);
  const proceeds = Math.max(0, gross - fee);

  const tooMany = sellQty > available;
  const pinValid = /^\d{4,6}$/.test(pin);
  const canSubmit = sellQty > 0 && !tooMany && pinValid && !sell.isPending;

  async function onConfirm() {
    try {
      const res = await sell.mutateAsync({ symbol: sym, order_type: 'market', quantity: sellQty, pin });
      setReceipt(res);
    } catch (e: any) {
      const code = e?.response?.data?.code;
      if (code === 'pin_not_set') {
        const ok = await confirmAsync({ title: 'Set a transaction PIN', message: 'You need a transaction PIN before you can trade.', confirmLabel: 'Set PIN' });
        if (ok) router.push('/invest/security/pin');
        return;
      }
      const msg = e?.response?.data?.error ?? 'Your order could not be placed. Any locked shares have been released.';
      alertAsync({ title: 'Order failed', message: msg });
    }
  }

  if (stock.isLoading || portfolio.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={`Sell ${sym}`} />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (!position || available <= 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={`Sell ${sym}`} />
        <StateView kind="empty" title="No shares to sell" message={`You don’t hold any available ${sym} shares.`} />
      </SafeAreaView>
    );
  }

  if (receipt) {
    const o = receipt.order;
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Order placed" showBack={false} />
        <ScrollView contentContainerStyle={styles.successWrap}>
          <View style={{ marginBottom: Spacing.md }}><CheckCircle2 size={56} color={Colors.teal} /></View>
          <Text style={styles.successTitle}>Sell order {orderStatusLabel(o.status).toLowerCase()}</Text>
          <Text style={styles.successSub}>{receipt.settlement_note}</Text>
          <View style={[styles.reviewCard, shadow1, { marginTop: Spacing.lg }]}>
            <Row label="Units sold" value={formatQty(o.filled_quantity || o.quantity)} />
            <Row label="Price" value={formatNaira(o.executed_price_kobo || o.estimated_price_kobo)} />
            <Row label="Fees" value={formatNaira(o.fees_kobo)} />
            <Row label="Net proceeds" value={formatNaira(o.total_amount_kobo)} strong />
          </View>
          <Text style={styles.disclaimer}>{receipt.risk_disclosure}</Text>
          <PrimaryButton label="Done" onPress={() => router.replace('/invest')} style={{ marginTop: Spacing.lg }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Sell ${sym}`} subtitle={stock.data?.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xxl }} keyboardShouldPersistTaps="handled">
        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>Units to sell</Text>
          <TextInput
            value={qty}
            onChangeText={setQty}
            placeholder="0"
            placeholderTextColor={Colors.outline}
            keyboardType="decimal-pad"
            style={styles.amountInput}
            autoFocus
          />
          <Text style={styles.cashHint}>Available: {formatQty(available)} units</Text>
          {tooMany && <Text style={styles.err}>You only have {formatQty(available)} units available.</Text>}
        </View>

        <View style={[styles.reviewCard, shadow1]}>
          <Row label="Market price" value={formatNaira(price)} />
          <Row label="Gross proceeds" value={formatNaira(gross)} />
          <Row label="Estimated fees" value={formatNaira(fee)} />
          <View style={styles.divider} />
          <Row label="Net proceeds" value={formatNaira(proceeds)} strong />
          <Text style={styles.estNote}>Proceeds become available cash after settlement (T+{stock.data?.settlement_days ?? 3}).</Text>
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

        <Text style={styles.disclaimer}>Stock prices can rise or fall. This is not financial advice.</Text>

        <View style={{ paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.md }}>
          <PrimaryButton label={sell.isPending ? 'Placing order…' : `Sell ${sym}`} onPress={onConfirm} loading={sell.isPending} disabled={!canSubmit} />
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
  amountInput: { ...Typography.displayLg, fontSize: 44, color: Colors.onSurface, minWidth: 120, textAlign: 'center', padding: 0, marginTop: Spacing.sm },
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
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xs },
});
