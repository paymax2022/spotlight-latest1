import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowDown, Fingerprint } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import { AssetIcon } from '@/features/crypto/components';
import { QuoteCountdown } from '@/features/crypto/components';
import { VolatilityWarning } from '@/features/crypto/components';
import { useAssets, useSwapQuote } from '@/features/crypto/hooks/useCrypto';
import { authorizePin } from '@/features/security/authorizePin';
import { formatCrypto, formatFiatObj } from '@/features/crypto/utils/cryptoFormatters';

export default function SwapReviewScreen() {
  const params = useLocalSearchParams<{
    from: string; to: string; fromId: string; toId: string; amount: string;
  }>();
  const assets = useAssets();
  const amount = Number(params.amount);

  // One firm quote per visit to this screen. The server prices both legs and keeps the
  // spread, so every number below is the server's, never a client-side calculation.
  const quoteQ = useSwapQuote({
    fromAssetId: params.fromId,
    toAssetId: params.toId,
    fromSymbol: params.from,
    toSymbol: params.to,
    fromAmount: amount,
  });
  const quote = quoteQ.data;

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();
  const [authorizing, setAuthorizing] = useState(false);

  const fromAsset = assets.data?.find((x) => x.id === params.fromId || x.symbol === params.from);
  const toAsset = assets.data?.find((x) => x.id === params.toId || x.symbol === params.to);

  if (!fromAsset || !toAsset) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review swap" />
        <StateView
          kind={assets.isError ? 'error' : 'loading'}
          title={assets.isError ? 'Could not prepare this swap' : undefined}
          message={assets.isError ? 'Please try again.' : 'Loading the market…'}
          actionLabel={assets.isError ? 'Back' : undefined}
          onAction={assets.isError ? () => goBack('/crypto/swap') : undefined}
        />
      </SafeAreaView>
    );
  }

  // A refused quote is an error the member has to read, not a spinner: the pair is
  // unpriced, the amount too small to convert, or the market declined it.
  if (quoteQ.isError || amount <= 0 || Number.isNaN(amount)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review swap" />
        <StateView
          kind="error"
          title="No rate for this swap"
          message={(quoteQ.error as Error)?.message ?? 'Enter an amount and try again.'}
          actionLabel="Back"
          onAction={() => goBack('/crypto/swap')}
        />
      </SafeAreaView>
    );
  }

  if (!quote) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review swap" />
        <StateView kind="loading" message="Requesting the firm rate…" />
      </SafeAreaView>
    );
  }

  const confirm = async () => {
    if (pin.length < 4) { setPinError('Enter your 4-digit transaction PIN.'); return; }
    setAuthorizing(true);
    setPinError(undefined);
    // /crypto/swap takes no PIN, so an unverified four digits must not reach it.
    const failure = await authorizePin(pin);
    setAuthorizing(false);
    if (failure) {
      setPin('');
      setPinError(failure);
      return;
    }
    router.push({
      pathname: '/crypto/swap/processing',
      params: {
        from: fromAsset.symbol, to: toAsset.symbol,
        fromId: fromAsset.id, toId: toAsset.id,
        amount: String(amount),
        ...(quote.quotationId ? { quotationId: quote.quotationId } : {}),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review swap" subtitle={`${fromAsset.symbol} → ${toAsset.symbol}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <QuoteCountdown expiresAt={quote.expiresAt} onExpire={() => quoteQ.refetch()} />

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
          <Text style={styles.rateNote}>
            The swap fills at the market price of the moment it is placed, so the amount you
            receive can move if this rate expires and you refresh it.
          </Text>
        </View>

        <VolatilityWarning />

        {/* PIN */}
        <View style={styles.pinCard}>
          <View style={styles.pinHead}>
            <Fingerprint size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.pinTitle}>Authorize with your PIN</Text>
          </View>
          <Text style={styles.pinHint}>Confirm this swap with your 4-digit transaction PIN.</Text>
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
        <PrimaryButton label="Confirm swap" onPress={() => { void confirm(); }} loading={authorizing} />
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
  rateNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  pinCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  pinHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  pinTitle: { ...Typography.titleMd, color: Colors.onSurface },
  pinHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
