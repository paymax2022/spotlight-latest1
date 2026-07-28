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
import { useAsset, useCryptoPortfolio } from '@/features/crypto/hooks/useCrypto';
import {
  buildQuote, formatFiat, formatFiatObj, formatCrypto, formatPrice,
  parseFiatToMinor, parseCryptoToMinor,
} from '@/features/crypto/utils/cryptoFormatters';
import { DEFAULT_FIAT } from '@/features/crypto/constants/crypto.constants';
import type { AmountBasis } from '@/features/crypto/types/crypto.types';

const PERCENTS = [25, 50, 75, 100];

export default function SellEntryScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const asset = useAsset(symbol);
  const portfolio = useCryptoPortfolio();
  const [basis, setBasis] = useState<AmountBasis>('crypto');
  const [input, setInput] = useState('');

  const fiat = DEFAULT_FIAT;
  const decimals = asset.data?.decimals ?? 8;
  const position = portfolio.data?.positions.find((p) => p.symbol === symbol);
  const heldMinor = position?.quantity.amount ?? 0;

  const amount = basis === 'crypto' ? parseCryptoToMinor(input, decimals) : parseFiatToMinor(input, fiat);

  const quote = useMemo(() => {
    if (!asset.data || !amount) return null;
    return buildQuote(asset.data, { assetId: asset.data.id, side: 'sell', basis, amount, currency: fiat });
  }, [asset.data, amount, basis, fiat]);

  if (asset.isLoading || portfolio.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Sell" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (asset.isError || !asset.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Sell" />
        <StateView kind="error" title="Couldn't load this asset" message="Please try again." actionLabel="Retry" onAction={() => asset.refetch()} />
      </SafeAreaView>
    );
  }

  const a = asset.data;

  // Restricted/empty: nothing to sell.
  if (heldMinor <= 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={`Sell ${a.symbol}`} />
        <StateView
          kind="empty" icon="Wallet"
          title={`You don't hold any ${a.symbol}`}
          message={`Buy ${a.symbol} first — then you can sell it back to cash anytime.`}
          actionLabel={`Buy ${a.symbol}`}
          onAction={() => router.replace({ pathname: '/crypto/buy', params: { symbol: a.symbol } })}
        />
      </SafeAreaView>
    );
  }

  const cryptoMinor = quote?.crypto.amount ?? 0;
  const overHolding = cryptoMinor > heldMinor;
  const sellable = !a.sellEnabled
    ? `Selling ${a.symbol} is temporarily paused.`
    : overHolding ? `You only hold ${formatCrypto(heldMinor, a.symbol, decimals)}.` : null;

  const otherSide = quote
    ? (basis === 'crypto' ? formatFiatObj(quote.totalFiat) : formatCrypto(quote.crypto.amount, a.symbol, decimals))
    : (basis === 'crypto' ? formatFiat(0, fiat) : `0 ${a.symbol}`);

  const setPercent = (pct: number) => {
    const qty = Math.round((heldMinor * pct) / 100);
    setBasis('crypto');
    setInput((qty / 10 ** decimals).toString());
  };

  const disabled = !quote || amount <= 0 || !!sellable;

  const onContinue = () => {
    if (!quote) return;
    router.push({ pathname: '/crypto/sell/review', params: { symbol: a.symbol, basis, amount: String(amount) } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Sell ${a.symbol}`} subtitle={formatPrice(a.symbol, a.price)} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.toggleWrap}>
          <SegmentedControl<AmountBasis>
            value={basis}
            onChange={(v) => { setBasis(v); setInput(''); }}
            options={[{ value: 'crypto', label: `Sell ${a.symbol}` }, { value: 'fiat', label: 'Get cash' }]}
          />
        </View>

        <View style={styles.field}>
          <View style={styles.fieldHead}>
            <Text style={styles.fieldLabel}>{basis === 'crypto' ? 'You sell' : 'You receive'}</Text>
            <Text style={styles.balance}>Holding: {formatCrypto(heldMinor, a.symbol, decimals)}</Text>
          </View>
          <View style={[styles.amountRow, !!sellable && styles.amountError]}>
            <View style={styles.unit}>
              {basis === 'crypto'
                ? <AssetIcon symbol={a.symbol} color={a.iconColor} size={28} />
                : <Text style={styles.unitText}>₦</Text>}
            </View>
            <TextInput
              style={styles.amountInput}
              value={input}
              onChangeText={setInput}
              placeholder="0.00"
              placeholderTextColor={Colors.outline}
              keyboardType="decimal-pad"
              autoFocus
              accessibilityLabel={basis === 'crypto' ? `Amount of ${a.symbol} to sell` : 'Cash to receive'}
            />
          </View>
          {sellable ? <Text style={styles.errorText}>{sellable}</Text> : null}
        </View>

        {/* Percent-of-holding chips */}
        <View style={styles.suggestRow}>
          {PERCENTS.map((pct) => (
            <Pressable key={pct} style={styles.suggestChip} onPress={() => setPercent(pct)} accessibilityRole="button">
              <Text style={styles.suggestText}>{pct === 100 ? 'Max' : `${pct}%`}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.swapWrap}>
          <View style={styles.swapLine} />
          <Pressable onPress={() => { setBasis(basis === 'crypto' ? 'fiat' : 'crypto'); setInput(''); }} style={styles.swapBtn} accessibilityRole="button" accessibilityLabel="Switch input">
            <ArrowDownUp size={18} color={Colors.onPrimary} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{basis === 'crypto' ? 'You receive (est.)' : 'You sell (est.)'}</Text>
          <View style={styles.amountRow}>
            <View style={styles.unit}>
              {basis === 'crypto'
                ? <Text style={styles.unitText}>₦</Text>
                : <AssetIcon symbol={a.symbol} color={a.iconColor} size={28} />}
            </View>
            <Text style={[styles.amountInput, styles.computed]} numberOfLines={1}>{otherSide}</Text>
          </View>
        </View>

        {quote ? (
          <View style={styles.rateLine}>
            <Text style={styles.rateText}>{formatPrice(a.symbol, quote.allInRate)}</Text>
            <Text style={styles.rateSub}>Net of spread & fees · final quote locks on the next screen</Text>
          </View>
        ) : (
          <StateView kind="empty" icon="Coins" title="Enter an amount" message="We'll show how much cash you'll receive before you confirm." compact />
        )}
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
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  suggestChip: { backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  suggestText: { ...Typography.labelMd, color: Colors.onSurface },
  swapWrap: { alignItems: 'center', justifyContent: 'center', height: 36, marginVertical: 2 },
  swapLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.surfaceContainerHigh },
  swapBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  rateLine: { marginTop: Spacing.lg, alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  rateText: { ...Typography.titleMd, color: Colors.primary },
  rateSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
