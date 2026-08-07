import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowDownUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import VolatilityWarning from '@/features/crypto/components/VolatilityWarning';
import { useAsset, useCryptoPortfolio } from '@/features/crypto/hooks/useCrypto';
import {
  buildQuote, formatFiat, formatFiatObj, formatCrypto, formatPrice,
  parseFiatToMinor, parseCryptoToMinor, fiatMinorToInput,
} from '@/features/crypto/utils/cryptoFormatters';
import { SUGGESTED_FIAT_AMOUNTS, DEFAULT_FIAT } from '@/features/crypto/constants/crypto.constants';
import type { AmountBasis } from '@/features/crypto/types/crypto.types';

export default function BuyEntryScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const asset = useAsset(symbol);
  const portfolio = useCryptoPortfolio();
  const [basis, setBasis] = useState<AmountBasis>('fiat');
  const [input, setInput] = useState('');

  const fiat = DEFAULT_FIAT;
  const decimals = asset.data?.decimals ?? 8;
  const amount = basis === 'fiat' ? parseFiatToMinor(input, fiat) : parseCryptoToMinor(input, decimals);

  const quote = useMemo(() => {
    if (!asset.data || !amount) return null;
    return buildQuote(asset.data, { assetId: asset.data.id, side: 'buy', basis, amount, currency: fiat });
  }, [asset.data, amount, basis, fiat]);

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
        <StateView kind="error" title="Couldn't load this asset" message="Please try again." actionLabel="Retry" onAction={() => asset.refetch()} />
      </SafeAreaView>
    );
  }

  const a = asset.data;
  const investable = portfolio.data?.investableBalance.amount ?? 0;
  const belowMin = quote ? quote.totalFiat.amount < a.minOrderAmount : false;
  const aboveMax = quote ? quote.totalFiat.amount > a.maxOrderAmount : false;
  const insufficient = quote ? quote.totalFiat.amount > investable : false;
  const suggestions = SUGGESTED_FIAT_AMOUNTS[fiat] ?? [];

  const error =
    insufficient ? `Not enough investable cash. Available: ${formatFiat(investable, fiat)}.`
    : belowMin ? `Minimum order is ${formatFiat(a.minOrderAmount, fiat)}.`
    : aboveMax ? `Maximum order is ${formatFiat(a.maxOrderAmount, fiat)}.`
    : null;

  const otherSide = quote
    ? (basis === 'fiat' ? formatCrypto(quote.crypto.amount, a.symbol, decimals) : formatFiatObj(quote.totalFiat))
    : (basis === 'fiat' ? `0 ${a.symbol}` : formatFiat(0, fiat));

  const disabled = !quote || amount <= 0 || !!error;

  const onContinue = () => {
    if (!quote) return;
    router.push({ pathname: '/crypto/buy/review', params: { symbol: a.symbol, basis, amount: String(amount) } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Buy ${a.symbol}`} subtitle={formatPrice(a.symbol, a.price)} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.toggleWrap}>
          <SegmentedControl<AmountBasis>
            value={basis}
            onChange={(v) => { setBasis(v); setInput(''); }}
            options={[{ value: 'fiat', label: 'Pay with cash' }, { value: 'crypto', label: `Buy ${a.symbol}` }]}
          />
        </View>

        {/* Amount field */}
        <View style={styles.field}>
          <View style={styles.fieldHead}>
            <Text style={styles.fieldLabel}>{basis === 'fiat' ? 'You pay' : `You buy`}</Text>
            <Text style={styles.balance}>Cash: {formatFiat(investable, fiat)}</Text>
          </View>
          <View style={[styles.amountRow, !!error && styles.amountError]}>
            <View style={styles.unit}>
              {basis === 'fiat'
                ? <Text style={styles.unitText}>₦</Text>
                : <AssetIcon symbol={a.symbol} color={a.iconColor} size={28} />}
            </View>
            <TextInput
              style={styles.amountInput}
              value={input}
              onChangeText={setInput}
              placeholder="0.00"
              placeholderTextColor={Colors.outline}
              keyboardType="decimal-pad"
              autoFocus
              accessibilityLabel={basis === 'fiat' ? 'Amount to pay' : `Amount of ${a.symbol} to buy`}
            />
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {/* Swap basis */}
        <View style={styles.swapWrap}>
          <View style={styles.swapLine} />
          <Pressable onPress={() => { setBasis(basis === 'fiat' ? 'crypto' : 'fiat'); setInput(''); }} style={styles.swapBtn} accessibilityRole="button" accessibilityLabel="Switch input">
            <ArrowDownUp size={18} color={Colors.onPrimary} strokeWidth={2.2} />
          </Pressable>
        </View>

        {/* Computed other side */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{basis === 'fiat' ? 'You receive (est.)' : 'You pay (est.)'}</Text>
          <View style={styles.amountRow}>
            <View style={styles.unit}>
              {basis === 'fiat'
                ? <AssetIcon symbol={a.symbol} color={a.iconColor} size={28} />
                : <Text style={styles.unitText}>₦</Text>}
            </View>
            <Text style={[styles.amountInput, styles.computed]} numberOfLines={1}>{otherSide}</Text>
          </View>
        </View>

        {/* Suggestions (fiat basis only) */}
        {basis === 'fiat' && suggestions.length > 0 ? (
          <View style={styles.suggestRow}>
            {suggestions.map((s) => (
              <Pressable key={s} style={styles.suggestChip} onPress={() => setInput(fiatMinorToInput(s, fiat))} accessibilityRole="button">
                <Text style={styles.suggestText}>{formatFiat(s, fiat, { decimals: false })}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Live rate line */}
        {quote ? (
          <View style={styles.rateLine}>
            <Text style={styles.rateText}>{formatPrice(a.symbol, quote.allInRate)}</Text>
            <Text style={styles.rateSub}>Includes spread · Paymax & provider fees itemised on the next screen</Text>
          </View>
        ) : (
          <StateView kind="empty" icon="Coins" title="Enter an amount" message="We'll show a live, all-in price before you confirm." compact />
        )}

        <View style={styles.warn}>
          <VolatilityWarning compact />
        </View>
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
  unitText: { ...Typography.headlineMd, color: Colors.onSurfaceVariant },
  amountInput: { flex: 1, textAlign: 'right', ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  computed: { color: Colors.onSurfaceVariant },
  errorText: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  swapWrap: { alignItems: 'center', justifyContent: 'center', height: 36, marginVertical: 2 },
  swapLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.surfaceContainerHigh },
  swapBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  suggestChip: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  suggestText: { ...Typography.labelMd, color: Colors.onSurface },
  rateLine: { marginTop: Spacing.lg, alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  rateText: { ...Typography.titleMd, color: Colors.primary },
  rateSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  warn: { marginTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
