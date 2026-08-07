import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Fingerprint, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import StockIcon from '@/features/stocks/components/StockIcon';
import OrderBreakdown from '@/features/stocks/components/OrderBreakdown';
import { useStock } from '@/features/stocks/hooks/useStocks';
import { buildEstimate, formatMoneyObj, formatShares } from '@/features/stocks/utils/stockFormatters';
import { SETTLEMENT_NOTE, NO_ADVICE_DISCLOSURE } from '@/features/stocks/constants/stocks.constants';
import type { OrderType } from '@/features/stocks/types/stocks.types';

export default function StockBuyReviewScreen() {
  const params = useLocalSearchParams<{ symbol: string; orderType: string; quantity: string; limitPrice?: string }>();
  const asset = useStock(params.symbol);
  const orderType = (params.orderType as OrderType) ?? 'market';
  const quantity = Number(params.quantity);
  const limitPrice = params.limitPrice ? Number(params.limitPrice) : undefined;

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();

  const estimate = useMemo(() => {
    if (!asset.data) return null;
    return buildEstimate(asset.data, { side: 'buy', orderType, quantity, limitPrice });
  }, [asset.data, orderType, quantity, limitPrice]);

  if (asset.isLoading || !estimate) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView kind="loading" message="Preparing your order…" />
      </SafeAreaView>
    );
  }
  if (asset.isError || !asset.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView kind="error" title="Couldn't prepare your order" message="Please go back and try again." actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  const a = asset.data;

  const confirm = () => {
    if (pin.length < 4) { setPinError('Enter your 4-digit transaction PIN.'); return; }
    setPinError(undefined);
    router.push({
      pathname: '/stocks/buy/processing',
      params: {
        symbol: a.symbol, orderType, quantity: String(quantity),
        ...(limitPrice ? { limitPrice: String(limitPrice) } : {}),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review order" subtitle={`Buy ${a.symbol}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Order summary hero */}
        <View style={styles.hero}>
          <StockIcon symbol={a.symbol} color={a.iconColor} size={48} />
          <Text style={styles.heroLabel}>You're buying</Text>
          <Text style={styles.heroAmount}>{`Buy ${formatShares(quantity)} of ${a.symbol}`}</Text>
          <Text style={styles.heroFiat}>for {formatMoneyObj(estimate.total)}</Text>
        </View>

        {/* Fees + order summary */}
        <OrderBreakdown estimate={estimate} />

        {/* Limit fill note */}
        {orderType === 'limit' ? (
          <View style={styles.infoNote}>
            <Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.infoText}>Order may not fill immediately — limit orders only execute at your price or better.</Text>
          </View>
        ) : null}

        {/* Settlement note */}
        <View style={styles.infoNote}>
          <Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.infoText}>{SETTLEMENT_NOTE}</Text>
        </View>

        {/* No-advice disclosure */}
        <Text style={styles.disclosure}>{NO_ADVICE_DISCLOSURE}</Text>

        {/* PIN confirmation */}
        <View style={styles.pinCard}>
          <View style={styles.pinHead}>
            <Fingerprint size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.pinTitle}>Authorize with your PIN</Text>
          </View>
          <Text style={styles.pinHint}>For your security, confirm this order with your 4-digit transaction PIN or biometrics.</Text>
          <TextInputField
            label="Transaction PIN"
            placeholder="Enter 4-digit PIN"
            keyboardType="number-pad"
            maxLength={4}
            secure
            value={pin}
            onChangeText={(t) => { setPin(t.replace(/\D/g, '').slice(0, 4)); if (pinError) setPinError(undefined); }}
            error={pinError}
          />
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label={`Confirm buy · ${formatMoneyObj(estimate.total)}`} onPress={confirm} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: {
    alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg, gap: 4,
  },
  heroLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  heroAmount: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  heroFiat: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  infoNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.surfaceContainer, borderRadius: Radius.md, padding: Spacing.sm,
  },
  infoText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
  disclosure: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 16 },
  pinCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  pinHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  pinTitle: { ...Typography.titleMd, color: Colors.onSurface },
  pinHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
