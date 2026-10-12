import React, { useCallback, useEffect, useState } from 'react';
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
import { useAsset, useQuoteSwap, useConfirmSwap } from '@/features/crypto/hooks/useCrypto';
import { buildQuote, formatCrypto, formatFiat, formatFiatObj } from '@/features/crypto/utils/cryptoFormatters';
import { cryptoSwapsEnabled } from '@/features/crypto/utils/swapPipeline';
import type { AmountBasis, CryptoAsset, CryptoQuote, CryptoSwap } from '@/features/crypto/types/crypto.types';

export default function BuyReviewScreen() {
  // One switch for the whole flow: the new provider swap pipeline, or the
  // legacy client-quote + /crypto/orders/buy path. Env-constant per session, so
  // this is a safe conditional render (hooks still run unconditionally below).
  return cryptoSwapsEnabled() ? <SwapBuyReview /> : <LegacyBuyReview />;
}

/** The entered amount, resolved to the NGN the user is spending (integer kobo). */
function ngnKoboFor(asset: CryptoAsset, basis: AmountBasis, amount: number): number {
  if (basis === 'fiat') return Math.round(amount);
  // Crypto-basis entry: estimate the NGN to spend from the indicative price. The
  // server re-prices from this kobo amount and is authoritative on what is bought.
  return Math.round((amount / 10 ** asset.decimals) * asset.price.amount);
}

// ─── New provider-driven swap pipeline (quote → confirm → poll) ──────────────

function SwapBuyReview() {
  const params = useLocalSearchParams<{ symbol: string; basis: string; amount: string }>();
  const asset = useAsset(params.symbol);
  const basis = (params.basis as AmountBasis) ?? 'fiat';
  const amount = Number(params.amount);

  const quoteMut = useQuoteSwap();
  const confirmMut = useConfirmSwap();

  const [swap, setSwap] = useState<CryptoSwap | null>(null);
  const [expired, setExpired] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();
  const [quoteError, setQuoteError] = useState<string | undefined>();

  const requestQuote = useCallback(() => {
    if (!asset.data) return;
    const ngnKobo = ngnKoboFor(asset.data, basis, amount);
    setQuoteError(undefined);
    quoteMut.mutate(
      { asset: asset.data.symbol, ngnKobo },
      {
        onSuccess: (s) => { setSwap(s); setExpired(false); setPin(''); setPinError(undefined); },
        onError: (err: unknown) => setQuoteError((err as { message?: string })?.message ?? 'Could not price your order.'),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.data, basis, amount]);

  // Build the initial server quote once the asset resolves.
  useEffect(() => {
    if (asset.data && !swap && !quoteMut.isPending) requestQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.data]);

  if (asset.isLoading || (!swap && !quoteError)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView kind="loading" message="Preparing your quote…" />
      </SafeAreaView>
    );
  }
  if (asset.isError || !asset.data || (quoteError && !swap)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView
          kind="error"
          title="Couldn't prepare your order"
          message={quoteError ?? 'Please go back and try again.'}
          actionLabel="Try again"
          onAction={() => (asset.data ? requestQuote() : goBack('/crypto/buy'))}
        />
      </SafeAreaView>
    );
  }

  const a = asset.data;
  const s = swap as CryptoSwap;
  const confirming = confirmMut.isPending;

  const confirm = () => {
    if (expired) { requestQuote(); return; }
    if (pin.length < 4) { setPinError('Enter your 4-digit transaction PIN.'); return; }
    setPinError(undefined);
    confirmMut.mutate(
      { id: s.id, pin },
      {
        onSuccess: (result) => {
          router.push({ pathname: '/crypto/buy/processing', params: { swapId: result.id } });
        },
        onError: (err: unknown) => {
          const e = err as { cryptoType?: string; message?: string };
          // Quote expired → let the user re-price in place.
          if (e.cryptoType === 'quote_expired') { setExpired(true); return; }
          // PIN problems → stay on the screen so they can retry without losing the quote.
          if (e.cryptoType === 'pin_invalid' || e.cryptoType === 'pin_not_set') {
            setPin('');
            setPinError(e.message ?? 'That PIN was not accepted.');
            return;
          }
          // Everything else (funds, limits, provider) → the failure screen.
          router.push({
            pathname: '/crypto/buy/failed',
            params: {
              symbol: a.symbol, basis, amount: String(amount),
              reason: e.message ?? 'The order could not be completed. No funds were debited.',
              kind: 'error',
            },
          });
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review order" subtitle={`Buy ${a.symbol}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {s.expiresAt ? <QuoteCountdown expiresAt={s.expiresAt} onExpire={() => setExpired(true)} /> : null}

        {/* Order summary hero (server-authoritative numbers) */}
        <View style={styles.hero}>
          <AssetIcon symbol={a.symbol} color={a.iconColor} size={48} />
          <Text style={styles.heroLabel}>You're buying</Text>
          <Text style={styles.heroAmount}>{`${s.quotedAmount} ${a.symbol}`}</Text>
          <Text style={styles.heroFiat}>for {formatFiat(s.totalKobo, 'NGN')}</Text>
        </View>

        {/* Server fee breakdown */}
        <View style={styles.breakdown}>
          <Row label="Amount" value={formatFiat(s.ngnKobo, 'NGN')} />
          <Row label={`Fee (${(s.feeBps / 100).toFixed(2)}%)`} value={formatFiat(s.feeKobo, 'NGN')} />
          <View style={styles.divider} />
          <Row label="Total to pay" value={formatFiat(s.totalKobo, 'NGN')} strong />
          <Row label={`Price per ${a.symbol}`} value={`₦${s.price}`} muted />
        </View>

        {/* Risk disclosure (required on every trade confirmation) */}
        <View style={styles.warn}>
          <VolatilityWarning message={a.riskDisclosure} />
        </View>

        {/* PIN confirmation */}
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
          <PrimaryButton label="Quote expired — refresh" onPress={() => requestQuote()} loading={quoteMut.isPending} />
        ) : (
          <PrimaryButton label={`Confirm buy · ${formatFiat(s.totalKobo, 'NGN')}`} onPress={confirm} loading={confirming} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && styles.rowMuted]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong, muted && styles.rowMuted]}>{value}</Text>
    </View>
  );
}

// ─── Legacy client-quote path (unchanged) ───────────────────────────────────

function LegacyBuyReview() {
  const params = useLocalSearchParams<{ symbol: string; basis: string; amount: string }>();
  const asset = useAsset(params.symbol);
  const basis = (params.basis as AmountBasis) ?? 'fiat';
  const amount = Number(params.amount);

  const makeQuote = useCallback((): CryptoQuote | null => {
    if (!asset.data) return null;
    return buildQuote(asset.data, { assetId: asset.data.id, side: 'buy', basis, amount, currency: 'NGN', lock: true });
  }, [asset.data, basis, amount]);

  const [quote, setQuote] = useState<CryptoQuote | null>(null);
  const [expired, setExpired] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();

  // Build the initial locked quote once the asset resolves.
  React.useEffect(() => { if (asset.data && !quote) setQuote(makeQuote()); }, [asset.data, quote, makeQuote]);

  const reQuote = () => { setQuote(makeQuote()); setExpired(false); };

  if (asset.isLoading || !quote) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView kind="loading" message="Preparing your quote…" />
      </SafeAreaView>
    );
  }
  if (asset.isError || !asset.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review order" />
        <StateView kind="error" title="Couldn't prepare your order" message="Please go back and try again." actionLabel="Back" onAction={() => goBack('/crypto/buy')} />
      </SafeAreaView>
    );
  }

  const a = asset.data;

  const confirm = () => {
    if (expired) { reQuote(); setPin(''); return; }
    if (pin.length < 4) { setPinError('Enter your 4-digit transaction PIN.'); return; }
    setPinError(undefined);
    router.push({
      pathname: '/crypto/buy/processing',
      params: { symbol: a.symbol, basis, amount: String(amount), expiresAt: quote.expiresAt },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review order" subtitle={`Buy ${a.symbol}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <QuoteCountdown expiresAt={quote.expiresAt} onExpire={() => setExpired(true)} />

        {/* Order summary hero */}
        <View style={styles.hero}>
          <AssetIcon symbol={a.symbol} color={a.iconColor} size={48} />
          <Text style={styles.heroLabel}>You're buying</Text>
          <Text style={styles.heroAmount}>{formatCrypto(quote.crypto.amount, a.symbol, a.decimals)}</Text>
          <Text style={styles.heroFiat}>for {formatFiatObj(quote.totalFiat)}</Text>
        </View>

        {/* Fees + order summary */}
        <CryptoQuoteBreakdown quote={quote} decimals={a.decimals} />

        {/* Risk disclosure (required on every trade confirmation) */}
        <View style={styles.warn}>
          <VolatilityWarning message={a.riskDisclosure} />
        </View>

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
        {expired ? (
          <PrimaryButton label="Quote expired — refresh" onPress={reQuote} />
        ) : (
          <PrimaryButton label={`Confirm buy · ${formatFiatObj(quote.totalFiat)}`} onPress={confirm} />
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
  breakdown: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface },
  rowStrong: { ...Typography.titleMd, color: Colors.onSurface },
  rowMuted: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
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
