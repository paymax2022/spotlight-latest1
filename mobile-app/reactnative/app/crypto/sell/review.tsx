import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Fingerprint } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import { AssetIcon } from '@/features/crypto/components';
import { CryptoQuoteBreakdown } from '@/features/crypto/components';
import { QuoteCountdown } from '@/features/crypto/components';
import { VolatilityWarning } from '@/features/crypto/components';
import { useAsset, useQuote } from '@/features/crypto/hooks/useCrypto';
import { authorizePin } from '@/features/security/authorizePin';
import { formatCrypto, formatFiatObj } from '@/features/crypto/utils/cryptoFormatters';
import type { AmountBasis } from '@/features/crypto/types/crypto.types';

export default function SellReviewScreen() {
  const params = useLocalSearchParams<{ symbol: string; basis: string; amount: string }>();
  const asset = useAsset(params.symbol);
  const basis = (params.basis as AmountBasis) ?? 'crypto';
  const amount = Number(params.amount);

  // The server prices the fill; this screen only renders what it returns.
  const quoteQ = useQuote({ assetId: params.symbol, side: 'sell', basis, amount, currency: 'NGN', lock: true });
  const quote = quoteQ.data;
  const [expired, setExpired] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();
  const [authorizing, setAuthorizing] = useState(false);

  const reQuote = () => { setExpired(false); void quoteQ.refetch(); };

  if (asset.isLoading || asset.isError || !asset.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView
          kind={asset.isError || !asset.data ? 'error' : 'loading'}
          title={asset.isError ? "Couldn't load this asset" : undefined}
          message={asset.isError ? 'Please try again.' : 'Preparing your quote…'}
          actionLabel={asset.isError ? 'Back' : undefined}
          onAction={asset.isError ? () => goBack('/crypto/sell') : undefined}
        />
      </SafeAreaView>
    );
  }

  // A quote that failed to arrive is an error, not a spinner: the server refused the
  // amount (nothing to sell, or the asset is unpriced) and the member has to see why
  // before authorising anything.
  if (quoteQ.isError || amount <= 0 || Number.isNaN(amount)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView
          kind="error"
          title="No quote for this order"
          message={(quoteQ.error as Error)?.message ?? 'Enter an amount and try again.'}
          actionLabel="Back"
          onAction={() => goBack('/crypto/sell')}
        />
      </SafeAreaView>
    );
  }

  if (!quote) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView kind="loading" message="Preparing your quote…" />
      </SafeAreaView>
    );
  }

  const a = asset.data;

  const confirm = async () => {
    if (expired) { reQuote(); setPin(''); return; }
    if (pin.length < 4) { setPinError('Enter your 4-digit transaction PIN.'); return; }
    setAuthorizing(true);
    setPinError(undefined);
    // The order endpoints take no PIN, so the credential is checked centrally here:
    // an unverified PIN must not reach a money mutation.
    const failure = await authorizePin(pin);
    setAuthorizing(false);
    if (failure) {
      setPin('');
      setPinError(failure);
      return;
    }
    // The processing screen re-quotes before it places the order, so only the trade
    // itself travels — never a price that may already be stale.
    router.push({
      pathname: '/crypto/sell/processing',
      params: { symbol: a.symbol, basis, amount: String(amount) },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review order" subtitle={`Sell ${a.symbol}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <QuoteCountdown expiresAt={quote.expiresAt} onExpire={() => setExpired(true)} />

        <View style={styles.hero}>
          <AssetIcon symbol={a.symbol} color={a.iconColor} size={48} />
          <Text style={styles.heroLabel}>You're selling</Text>
          <Text style={styles.heroAmount}>{formatCrypto(quote.crypto.amount, a.symbol, a.decimals)}</Text>
          <Text style={styles.heroFiat}>for {formatFiatObj(quote.totalFiat)}</Text>
        </View>

        <CryptoQuoteBreakdown quote={quote} decimals={a.decimals} />

        <View style={styles.warn}>
          <VolatilityWarning message={a.riskDisclosure} />
        </View>

        <View style={styles.pinCard}>
          <View style={styles.pinHead}>
            <Fingerprint size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.pinTitle}>Authorize with your PIN</Text>
          </View>
          <Text style={styles.pinHint}>For your security, confirm this order with your 4-digit transaction PIN.</Text>
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
        {expired ? (
          <PrimaryButton label="Quote expired — refresh" onPress={reQuote} />
        ) : (
          <PrimaryButton label={`Confirm sell · ${formatFiatObj(quote.totalFiat)}`} onPress={() => { void confirm(); }} loading={authorizing} />
        )}
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
  heroAmount: { ...Typography.headlineMd, color: Colors.onSurface },
  heroFiat: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  warn: {},
  pinCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  pinHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  pinTitle: { ...Typography.titleMd, color: Colors.onSurface },
  pinHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
