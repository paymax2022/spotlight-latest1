import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowDown, Fingerprint } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import AssetIcon from '@/features/crypto/components/AssetIcon';
import QuoteCountdown from '@/features/crypto/components/QuoteCountdown';
import VolatilityWarning from '@/features/crypto/components/VolatilityWarning';
import { useAssets } from '@/features/crypto/hooks/useCrypto';
import { buildSwapQuote, formatCrypto, formatFiatObj } from '@/features/crypto/utils/cryptoFormatters';
import type { SwapQuote } from '@/features/crypto/types/crypto.types';

export default function SwapReviewScreen() {
  const params = useLocalSearchParams<{ from: string; to: string; amount: string }>();
  const assets = useAssets();
  const fromAsset = assets.data?.find((a) => a.symbol === params.from);
  const toAsset = assets.data?.find((a) => a.symbol === params.to);
  const amount = Number(params.amount);

  const makeQuote = useCallback((): SwapQuote | null => {
    if (!fromAsset || !toAsset) return null;
    return buildSwapQuote(fromAsset, toAsset, amount);
  }, [fromAsset, toAsset, amount]);

  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [expired, setExpired] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();

  React.useEffect(() => { if (fromAsset && toAsset && !quote) setQuote(makeQuote()); }, [fromAsset, toAsset, quote, makeQuote]);

  const reQuote = () => { setQuote(makeQuote()); setExpired(false); };

  if (assets.isLoading || !quote || !fromAsset || !toAsset) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review swap" />
        <StateView kind={assets.isError ? 'error' : 'loading'} message="Preparing your quote…" title={assets.isError ? 'Could not prepare swap' : undefined} actionLabel={assets.isError ? 'Back' : undefined} onAction={assets.isError ? () => router.back() : undefined} />
      </SafeAreaView>
    );
  }

  const confirm = () => {
    if (expired) { reQuote(); setPin(''); return; }
    if (pin.length < 4) { setPinError('Enter your 4-digit transaction PIN.'); return; }
    setPinError(undefined);
    router.push({ pathname: '/crypto/swap/processing', params: { from: params.from, to: params.to, amount: String(amount), expiresAt: quote.expiresAt } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review swap" subtitle={`${fromAsset.symbol} → ${toAsset.symbol}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <QuoteCountdown expiresAt={quote.expiresAt} onExpire={() => setExpired(true)} />

        {/* Swap hero */}
        <View style={styles.hero}>
          <View style={styles.legRow}>
            <AssetIcon symbol={fromAsset.symbol} color={fromAsset.iconColor} size={36} />
            <View style={styles.flex}>
              <Text style={styles.legLabel}>You swap</Text>
              <Text style={styles.legAmount}>{formatCrypto(quote.from.amount, fromAsset.symbol, fromAsset.decimals)}</Text>
            </View>
          </View>
          <View style={styles.arrowWrap}><ArrowDown size={18} color={Colors.outline} strokeWidth={2} /></View>
          <View style={styles.legRow}>
            <AssetIcon symbol={toAsset.symbol} color={toAsset.iconColor} size={36} />
            <View style={styles.flex}>
              <Text style={styles.legLabel}>You receive</Text>
              <Text style={[styles.legAmount, styles.legReceive]}>{formatCrypto(quote.to.amount, toAsset.symbol, toAsset.decimals)}</Text>
            </View>
          </View>
        </View>

        {/* Breakdown */}
        <View style={styles.card}>
          <Row label="Rate" value={`1 ${fromAsset.symbol} ≈ ${quote.rate.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${toAsset.symbol}`} />
          <Row label="Spread" value={`${quote.spreadPct.toFixed(2)}%`} muted />
          <Row label="Swap fee" value={formatFiatObj(quote.fee)} muted />
          <View style={styles.divider} />
          <Row label="Value" value={formatFiatObj(quote.fiatValue)} emphasis />
        </View>

        <VolatilityWarning />

        {/* PIN */}
        <View style={styles.pinCard}>
          <View style={styles.pinHead}>
            <Fingerprint size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.pinTitle}>Authorize with your PIN</Text>
          </View>
          <Text style={styles.pinHint}>Confirm this swap with your 4-digit transaction PIN or biometrics.</Text>
          <TextInputField
            label="Transaction PIN"
            placeholder="Enter 4-digit PIN"
            keyboardType="number-pad"
            maxLength={4}
            secure
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 4))}
            error={pinError}
          />
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {expired ? (
          <PrimaryButton label="Quote expired — refresh" onPress={reQuote} />
        ) : (
          <PrimaryButton label={`Confirm swap`} onPress={confirm} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Row({ label, value, emphasis, muted }: { label: string; value: string; emphasis?: boolean; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowMuted]}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowEmphasis, muted && styles.rowMutedValue]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  flex: { flex: 1 },
  hero: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm,
  },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  legLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  legAmount: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 1 },
  legReceive: { color: Colors.primary },
  arrowWrap: { alignItems: 'center' },
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurface, flexShrink: 0 },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface, textAlign: 'right', flexShrink: 1 },
  rowEmphasis: { color: Colors.primary },
  rowMuted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowMutedValue: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  pinCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  pinHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  pinTitle: { ...Typography.titleMd, color: Colors.onSurface },
  pinHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
