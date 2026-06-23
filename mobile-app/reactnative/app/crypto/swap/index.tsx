import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowDownUp, ChevronDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import VolatilityWarning from '@/features/crypto/components/VolatilityWarning';
import { useAssets, useCryptoPortfolio } from '@/features/crypto/hooks/useCrypto';
import {
  buildSwapQuote, formatCrypto, formatFiatObj, parseCryptoToMinor,
} from '@/features/crypto/utils/cryptoFormatters';

const PERCENTS = [25, 50, 100];

export default function SwapEntryScreen() {
  const { from: fromParam } = useLocalSearchParams<{ from?: string }>();
  const assets = useAssets();
  const portfolio = useCryptoPortfolio();

  const tradable = useMemo(() => (assets.data ?? []).filter((a) => a.status === 'active'), [assets.data]);
  const held = portfolio.data?.positions ?? [];

  const [fromSym, setFromSym] = useState<string | null>(null);
  const [toSym, setToSym] = useState<string | null>(null);
  const [input, setInput] = useState('');

  const fromAsset =
    tradable.find((a) => a.symbol === fromSym) ??
    tradable.find((a) => a.symbol === fromParam) ??
    tradable.find((a) => held.some((p) => p.symbol === a.symbol)) ??
    tradable[0];
  const toAsset =
    tradable.find((a) => a.symbol === toSym && a.symbol !== fromAsset?.symbol) ??
    tradable.find((a) => a.symbol !== fromAsset?.symbol);

  // Build the live preview quote (hook must run before any early return).
  const quote = useMemo(() => {
    if (!fromAsset || !toAsset) return null;
    const amt = parseCryptoToMinor(input, fromAsset.decimals);
    if (!amt) return null;
    return buildSwapQuote(fromAsset, toAsset, amt);
  }, [fromAsset, toAsset, input]);

  if (assets.isLoading || portfolio.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Swap" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (!fromAsset || !toAsset) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Swap" />
        <StateView kind="empty" icon="ArrowLeftRight" title="Swap unavailable" message="At least two tradable assets are needed to swap." actionLabel="Back to Crypto" onAction={() => router.replace('/crypto')} />
      </SafeAreaView>
    );
  }

  const decimals = fromAsset.decimals;
  const heldMinor = held.find((p) => p.symbol === fromAsset.symbol)?.quantity.amount ?? 0;
  const amount = parseCryptoToMinor(input, decimals);

  const overHolding = amount > heldMinor;
  const error = overHolding ? `You only hold ${formatCrypto(heldMinor, fromAsset.symbol, decimals)}.` : null;
  const disabled = !quote || amount <= 0 || !!error;

  const setPercent = (pct: number) => setInput(((heldMinor * pct) / 100 / 10 ** decimals).toString());
  const flip = () => { setFromSym(toAsset.symbol); setToSym(fromAsset.symbol); setInput(''); };

  // Cycle the `to` asset through the other tradable assets.
  const cycleTo = () => {
    const others = tradable.filter((a) => a.symbol !== fromAsset.symbol);
    const idx = others.findIndex((a) => a.symbol === toAsset.symbol);
    setToSym(others[(idx + 1) % others.length].symbol);
  };
  const cycleFrom = () => {
    const idx = tradable.findIndex((a) => a.symbol === fromAsset.symbol);
    const next = tradable[(idx + 1) % tradable.length];
    setFromSym(next.symbol);
    if (next.symbol === toAsset.symbol) setToSym(fromAsset.symbol);
    setInput('');
  };

  const onContinue = () => {
    if (!quote) return;
    router.push({ pathname: '/crypto/swap/review', params: { from: fromAsset.symbol, to: toAsset.symbol, amount: String(amount) } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Swap" subtitle="Convert one crypto to another" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* From */}
        <View style={styles.field}>
          <View style={styles.fieldHead}>
            <Text style={styles.fieldLabel}>From</Text>
            <Text style={styles.balance}>Holding: {formatCrypto(heldMinor, fromAsset.symbol, decimals)}</Text>
          </View>
          <View style={[styles.amountRow, !!error && styles.amountError]}>
            <Pressable style={styles.assetPick} onPress={cycleFrom} accessibilityRole="button" accessibilityLabel="Change from asset">
              <AssetIcon symbol={fromAsset.symbol} color={fromAsset.iconColor} size={28} />
              <Text style={styles.assetSym}>{fromAsset.symbol}</Text>
              <ChevronDown size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
            <TextInput
              style={styles.amountInput}
              value={input}
              onChangeText={setInput}
              placeholder="0.00"
              placeholderTextColor={Colors.outline}
              keyboardType="decimal-pad"
              autoFocus
              accessibilityLabel={`Amount of ${fromAsset.symbol} to swap`}
            />
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {/* Percent chips */}
        <View style={styles.suggestRow}>
          {PERCENTS.map((pct) => (
            <Pressable key={pct} style={styles.suggestChip} onPress={() => setPercent(pct)} accessibilityRole="button">
              <Text style={styles.suggestText}>{pct === 100 ? 'Max' : `${pct}%`}</Text>
            </Pressable>
          ))}
        </View>

        {/* Flip */}
        <View style={styles.swapWrap}>
          <View style={styles.swapLine} />
          <Pressable onPress={flip} style={styles.swapBtn} accessibilityRole="button" accessibilityLabel="Flip assets">
            <ArrowDownUp size={18} color={Colors.onPrimary} strokeWidth={2.2} />
          </Pressable>
        </View>

        {/* To */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>To (est.)</Text>
          <View style={styles.amountRow}>
            <Pressable style={styles.assetPick} onPress={cycleTo} accessibilityRole="button" accessibilityLabel="Change to asset">
              <AssetIcon symbol={toAsset.symbol} color={toAsset.iconColor} size={28} />
              <Text style={styles.assetSym}>{toAsset.symbol}</Text>
              <ChevronDown size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
            <Text style={[styles.amountInput, styles.computed]} numberOfLines={1}>
              {quote ? formatCrypto(quote.to.amount, toAsset.symbol, toAsset.decimals).replace(` ${toAsset.symbol}`, '') : '0.00'}
            </Text>
          </View>
        </View>

        {/* Live rate */}
        {quote ? (
          <View style={styles.rateLine}>
            <Text style={styles.rateText}>1 {fromAsset.symbol} ≈ {quote.rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} {toAsset.symbol}</Text>
            <Text style={styles.rateSub}>≈ {formatFiatObj(quote.fiatValue)} · includes spread & fee</Text>
          </View>
        ) : (
          <StateView kind="empty" icon="ArrowLeftRight" title="Enter an amount" message="We'll show a live rate before you confirm." compact />
        )}

        <View style={styles.warn}>
          <VolatilityWarning compact />
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Review swap" onPress={onContinue} disabled={disabled} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingTop: Spacing.sm },
  field: { marginBottom: Spacing.xs },
  fieldHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  balance: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  amountRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.transparent, paddingHorizontal: Spacing.sm, height: 68,
  },
  amountError: { borderColor: Colors.error },
  assetPick: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: 10, paddingVertical: 6 },
  assetSym: { ...Typography.labelLg, color: Colors.onSurface },
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
  warn: { marginTop: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
