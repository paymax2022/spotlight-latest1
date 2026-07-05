import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import TextInputField from '@/components/TextInputField';
import StockIcon from '@/features/stocks/components/StockIcon';
import { useStock, useStockPortfolio } from '@/features/stocks/hooks/useStocks';
import {
  buildEstimate, formatMoney, formatMoneyObj, formatShares, parseToMinor, minorToInput,
} from '@/features/stocks/utils/stockFormatters';
import { MARKET_CLOSED_NOTE } from '@/features/stocks/constants/stocks.constants';
import type { OrderType } from '@/features/stocks/types/stocks.types';

const SHARE_SUGGESTIONS = [1, 5, 10, 25];

export default function StockBuyEntryScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const asset = useStock(symbol);
  const portfolio = useStockPortfolio();
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [qtyInput, setQtyInput] = useState('');
  const [limitInput, setLimitInput] = useState('');

  const quantity = Math.max(0, Math.floor(Number(qtyInput.replace(/[^0-9]/g, '')) || 0));
  const currency = asset.data?.currency ?? 'NGN';
  const limitPrice = orderType === 'limit' ? parseToMinor(limitInput, currency) : undefined;

  const estimate = useMemo(() => {
    if (!asset.data || quantity <= 0) return null;
    if (orderType === 'limit' && (!limitPrice || limitPrice <= 0)) return null;
    return buildEstimate(asset.data, { side: 'buy', orderType, quantity, limitPrice });
  }, [asset.data, quantity, orderType, limitPrice]);

  if (asset.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Buy" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (asset.isError || !asset.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Buy" />
        <StateView kind="error" title="Couldn't load this stock" message="Please try again." actionLabel="Retry" onAction={() => asset.refetch()} />
      </SafeAreaView>
    );
  }

  const a = asset.data;
  const investable = portfolio.data?.investableBalance.amount ?? 0;
  const marketClosed = a.marketStatus === 'closed';
  const closedBlocked = marketClosed && orderType === 'market';

  const insufficient = estimate ? estimate.total.amount > investable : false;
  const belowMin = estimate ? estimate.gross.amount < a.minOrderAmount : false;
  const aboveMax = estimate ? estimate.gross.amount > a.maxOrderAmount : false;
  const limitMissing = orderType === 'limit' && quantity > 0 && (!limitPrice || limitPrice <= 0);

  const error =
    insufficient ? `Not enough investable cash. Available: ${formatMoney(investable, currency)}.`
    : belowMin ? `Minimum order is ${formatMoney(a.minOrderAmount, currency)}.`
    : aboveMax ? `Maximum order is ${formatMoney(a.maxOrderAmount, currency)}.`
    : limitMissing ? 'Enter a limit price per share.'
    : null;

  const disabled = !estimate || quantity <= 0 || !!error || closedBlocked;

  const onContinue = () => {
    if (!estimate) return;
    router.push({
      pathname: '/stocks/buy/review',
      params: {
        symbol: a.symbol, orderType, quantity: String(quantity),
        ...(orderType === 'limit' && limitPrice ? { limitPrice: String(limitPrice) } : {}),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Buy ${a.symbol}`} subtitle={`${formatMoneyObj(a.price)} / share`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.toggleWrap}>
          <SegmentedControl<OrderType>
            value={orderType}
            onChange={(v) => setOrderType(v)}
            options={[{ value: 'market', label: 'Market' }, { value: 'limit', label: 'Limit' }]}
          />
        </View>

        {/* Quantity field */}
        <View style={styles.field}>
          <View style={styles.fieldHead}>
            <Text style={styles.fieldLabel}>Shares to buy</Text>
            <Text style={styles.balance}>Cash: {formatMoney(investable, currency)}</Text>
          </View>
          <View style={[styles.amountRow, !!error && styles.amountError]}>
            <View style={styles.unit}>
              <StockIcon symbol={a.symbol} color={a.iconColor} size={28} />
            </View>
            <TextInput
              style={styles.amountInput}
              value={qtyInput}
              onChangeText={(t) => setQtyInput(t.replace(/[^0-9]/g, ''))}
              placeholder="0"
              placeholderTextColor={Colors.outline}
              keyboardType="number-pad"
              autoFocus
              accessibilityLabel={`Number of ${a.symbol} shares to buy`}
            />
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {/* Share suggestion chips */}
        <View style={styles.suggestRow}>
          {SHARE_SUGGESTIONS.map((n) => (
            <Pressable key={n} style={styles.suggestChip} onPress={() => setQtyInput(String(n))} accessibilityRole="button">
              <Text style={styles.suggestText}>{n} {n === 1 ? 'share' : 'shares'}</Text>
            </Pressable>
          ))}
        </View>

        {/* Limit price (limit orders only) */}
        {orderType === 'limit' ? (
          <View style={styles.limitWrap}>
            <TextInputField
              label="Limit price (per share)"
              placeholder={minorToInput(a.price.amount, currency)}
              keyboardType="decimal-pad"
              value={limitInput}
              onChangeText={(t) => setLimitInput(t.replace(/[^0-9.]/g, ''))}
            />
          </View>
        ) : null}

        {/* Live preview */}
        {estimate ? (
          <View style={styles.preview}>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>{orderType === 'limit' ? 'Limit price' : 'Est. price'}</Text>
              <Text style={styles.previewValue}>{formatMoneyObj(estimate.limitPrice ?? estimate.estPrice)} / share</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Shares</Text>
              <Text style={styles.previewValue}>{formatShares(estimate.quantity)}</Text>
            </View>
            <View style={styles.previewDivider} />
            <View style={styles.previewRow}>
              <Text style={styles.previewTotalLabel}>Est. total to pay</Text>
              <Text style={styles.previewTotal}>{formatMoneyObj(estimate.total)}</Text>
            </View>
          </View>
        ) : (
          <StateView kind="empty" icon="LineChart" title="Enter a quantity" message="We'll show an estimated total before you confirm." compact />
        )}

        {/* Market-closed note */}
        {marketClosed ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>
              {MARKET_CLOSED_NOTE}{orderType === 'market' ? ' Switch to a Limit order to queue at your price.' : ''}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Review order" onPress={onContinue} disabled={disabled} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingTop: Spacing.sm },
  toggleWrap: { marginHorizontal: -Spacing.containerMargin, marginBottom: Spacing.lg },
  field: { marginBottom: Spacing.xs },
  fieldHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  balance: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.md, height: 64,
  },
  amountError: { borderColor: Colors.error },
  unit: { minWidth: 32, alignItems: 'center', justifyContent: 'center' },
  amountInput: { flex: 1, textAlign: 'right', ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  errorText: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  suggestChip: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  suggestText: { ...Typography.labelMd, color: Colors.onSurface },
  limitWrap: { marginTop: Spacing.lg },
  preview: { marginTop: Spacing.lg, gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  previewValue: { ...Typography.labelLg, color: Colors.onSurface },
  previewDivider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  previewTotalLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  previewTotal: { ...Typography.titleMd, color: Colors.primary },
  note: { marginTop: Spacing.md, backgroundColor: Colors.surfaceContainer, borderRadius: Radius.md, padding: Spacing.md },
  noteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
