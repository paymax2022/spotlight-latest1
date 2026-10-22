// Provider-rail (Quidax) buy/sell: the review screen shows the SERVER's quote and
// collects the PIN; the processing screen confirms it and follows the swap to a final
// state. Nothing here prices or settles: the app renders what the server returns.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Fingerprint, Hourglass, ShieldCheck } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import { goBack } from '@/lib/navigation';
import { AssetIcon, QuoteCountdown, VolatilityWarning } from './index';
import { useAsset, useConfirmProviderSwap, useProviderQuote, useTradingRail } from '../hooks/useCrypto';
import { getProviderSwap } from '../api/swaps.api';
import { formatFiat } from '../utils/cryptoFormatters';
import { quoteInputFor, unitsToMinor } from '../utils/providerPortfolio';
import {
  POLL_BUDGET_MS, isSwapPinError, phaseOf, pollDelayMs, setSwapPin, swapErrorCode, swapErrorMessage,
  takeSwapPin, type ProviderSwap, type SwapSide,
} from '../utils/providerSwap';
import type { AmountBasis } from '../types/crypto.types';

type TradeParams = { side: SwapSide; symbol: string; basis: AmountBasis; amount: string; pinError?: string };

const verbOf = (side: SwapSide) => (side === 'buy' ? 'Buy' : 'Sell');

/** Trim a decimal string for display without converting it to a float. */
function units(s: string | undefined, max = 8): string {
  if (!s) return '0';
  const [i, f = ''] = s.split('.');
  const frac = f.slice(0, max).replace(/0+$/, '');
  return `${Number(i).toLocaleString('en-NG')}${frac ? `.${frac}` : ''}`;
}

/** NGN per 1 coin implied by the server quote (display only). */
function impliedRate(sw: ProviderSwap): string {
  const coins = Number(sw.side === 'buy' ? sw.quotedAmount : sw.amount);
  if (!(coins > 0)) return '—';
  return formatFiat(Math.round(sw.ngnKobo / coins), 'NGN');
}

export function ProviderTradeReview({ side, symbol, basis, amount, pinError: initialPinError }: TradeParams) {
  const asset = useAsset(symbol);
  const quoteM = useProviderQuote();
  const [swap, setSwap] = useState<ProviderSwap | null>(null);
  const [expired, setExpired] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>(initialPinError);
  const requested = useRef(false);

  const fetchQuote = useCallback(() => {
    if (!asset.data) return;
    const input = quoteInputFor(side, basis, Number(amount), asset.data);
    if (!input) return;
    setExpired(false);
    setSwap(null);
    quoteM.mutate(input, { onSuccess: setSwap });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.data, side, basis, amount]);

  useEffect(() => {
    if (requested.current || !asset.data) return;
    requested.current = true;
    fetchQuote();
  }, [asset.data, fetchQuote]);

  const onExpire = useCallback(() => setExpired(true), []);
  const verb = verbOf(side);
  const header = <ScreenHeader title="Review order" subtitle={`${verb} ${symbol}`} />;

  const invalid = asset.data && !quoteInputFor(side, basis, Number(amount), asset.data);
  if (asset.isError || invalid) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        <StateView kind="error" title="Couldn't prepare your order" message="Go back and enter the amount again." actionLabel="Back" onAction={() => goBack(`/crypto/${side}`)} />
      </SafeAreaView>
    );
  }
  if (quoteM.isError) {
    const code = swapErrorCode(quoteM.error);
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        <StateView kind="error" title="We couldn't get a price" message={swapErrorMessage(code, side)} actionLabel="Try again" onAction={fetchQuote} secondaryActionLabel="Back" onSecondaryAction={() => goBack(`/crypto/${side}`)} />
      </SafeAreaView>
    );
  }
  if (!asset.data || !swap) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        <StateView kind="loading" message="Getting a live price from our crypto partner…" />
      </SafeAreaView>
    );
  }

  const a = asset.data;
  const confirm = () => {
    if (expired) { setPin(''); fetchQuote(); return; }
    if (!/^\d{4}$/.test(pin)) { setPinError('Enter your 4-digit transaction PIN.'); return; }
    setPinError(undefined);
    setSwapPin(pin);
    setPin('');
    router.push({ pathname: `/crypto/${side}/processing`, params: { symbol, basis, amount, swapId: swap.id } });
  };

  const feePct = (swap.feeBps / 100).toFixed(2).replace(/\.?0+$/, '');
  const rows: [string, string][] = side === 'buy'
    ? [
        ['Rate', `${impliedRate(swap)} per ${a.symbol}`],
        ['Amount', formatFiat(swap.ngnKobo, 'NGN')],
        [`Fee (${feePct}%)`, formatFiat(swap.feeKobo, 'NGN')],
        ['Total from your wallet', formatFiat(swap.totalKobo, 'NGN')],
      ]
    : [
        ['Rate', `${impliedRate(swap)} per ${a.symbol}`],
        ['Sale value', formatFiat(swap.ngnKobo, 'NGN')],
        [`Fee (${feePct}%)`, formatFiat(swap.feeKobo, 'NGN')],
        ['You receive', formatFiat(swap.totalKobo, 'NGN')],
      ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {header}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {swap.expiresAt ? <QuoteCountdown expiresAt={swap.expiresAt} onExpire={onExpire} /> : null}

        <View style={styles.hero}>
          <AssetIcon symbol={a.symbol} color={a.iconColor} size={48} />
          <Text style={styles.heroLabel}>{side === 'buy' ? "You're buying about" : "You're selling"}</Text>
          <Text style={styles.heroAmount} accessibilityRole="header">
            {units(side === 'buy' ? swap.quotedAmount : swap.amount, a.decimals)} {a.symbol}
          </Text>
          <Text style={styles.heroFiat}>
            {side === 'buy' ? `for ${formatFiat(swap.totalKobo, 'NGN')}` : `for ${formatFiat(swap.totalKobo, 'NGN')} after fees`}
          </Text>
        </View>

        <View style={styles.card} accessibilityLabel="Order breakdown">
          {rows.map(([k, v], i) => (
            <View key={k} style={[styles.row, i === rows.length - 1 && styles.rowTotal]}>
              <Text style={[styles.rowKey, i === rows.length - 1 && styles.rowKeyTotal]}>{k}</Text>
              <Text style={[styles.rowVal, i === rows.length - 1 && styles.rowValTotal]}>{v}</Text>
            </View>
          ))}
          <Text style={styles.footnote}>
            {side === 'buy'
              ? `Executed by our licensed partner at this price. The ${a.symbol} goes to your Paymax crypto account.`
              : 'Your naira is credited to your wallet once our partner confirms the sale, usually within seconds.'}
          </Text>
        </View>

        <VolatilityWarning message={a.riskDisclosure} />

        <View style={styles.card}>
          <View style={styles.pinHead}>
            <Fingerprint size={18} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.pinTitle}>Authorise with your PIN</Text>
          </View>
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
        {expired
          ? <PrimaryButton label="Get a new price" onPress={confirm} loading={quoteM.isPending} />
          : <PrimaryButton label={`${verb} for ${formatFiat(swap.totalKobo, 'NGN')}`} onPress={confirm} />}
      </SafeAreaView>
    </SafeAreaView>
  );
}

/**
 * Picks the rail before any trade screen renders. Waiting is deliberate: guessing the
 * legacy rail on a slow or failed config read could send a trade to the wrong book.
 */
export function RailGate({ title, provider, legacy }: { title: string; provider: () => React.ReactElement; legacy: () => React.ReactElement }) {
  const rail = useTradingRail();
  if (rail.data === 'provider') return provider();
  if (rail.data === 'ledger') return legacy();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} />
      {rail.isError
        ? <StateView kind="error" title="Trading is unavailable" message="We couldn't reach the trading service, so nothing was sent. Check your connection and try again." actionLabel="Try again" onAction={() => rail.refetch()} />
        : <StateView kind="loading" message="Connecting to trading…" />}
    </SafeAreaView>
  );
}

type Outcome =
  | { kind: 'working' }
  | { kind: 'pending'; swap: ProviderSwap }
  | { kind: 'review'; swap: ProviderSwap };

export function ProviderTradeProcessing({ side, symbol, basis, amount, swapId }: TradeParams & { swapId: string }) {
  const asset = useAsset(symbol);
  const confirmM = useConfirmProviderSwap();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'working' });
  const fired = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const backToReview = useCallback((pinError?: string) => {
    router.replace({ pathname: `/crypto/${side}/review`, params: { symbol, basis, amount, ...(pinError ? { pinError } : {}) } });
  }, [side, symbol, basis, amount]);

  const finish = useCallback((sw: ProviderSwap) => {
    const phase = phaseOf(sw.status);
    if (phase === 'done') {
      const decimals = asset.data?.decimals ?? 8;
      const cryptoUnits = side === 'buy' ? (sw.receivedAmount ?? sw.quotedAmount) : (sw.amount ?? '0');
      const ngn = side === 'buy' ? sw.totalKobo : sw.ngnKobo - sw.feeKobo;
      router.replace({
        pathname: `/crypto/${side}/success`,
        params: { reference: sw.id.slice(0, 8).toUpperCase(), symbol, crypto: String(unitsToMinor(cryptoUnits, decimals)), fiat: String(ngn), txId: '', rail: 'provider' },
      });
      return true;
    }
    if (phase === 'failed' || phase === 'expired') {
      router.replace({
        pathname: `/crypto/${side}/failed`,
        params: {
          symbol, basis, amount, kind: phase === 'expired' ? 'quote_expired' : 'error',
          reason: phase === 'expired'
            ? swapErrorMessage('quote_expired', side)
            : side === 'buy'
              ? 'Our crypto partner declined this order. Any amount held for it has been returned to your wallet.'
              : 'Our crypto partner declined this sale. Nothing was sold.',
        },
      });
      return true;
    }
    if (phase === 'review') { setOutcome({ kind: 'review', swap: sw }); return true; }
    return false;
  }, [asset.data, side, symbol, basis, amount]);

  const follow = useCallback(async (sw: ProviderSwap) => {
    if (finish(sw)) return;
    const started = Date.now();
    for (let attempt = 0; alive.current && Date.now() - started < POLL_BUDGET_MS; attempt++) {
      await new Promise((r) => setTimeout(r, pollDelayMs(attempt)));
      if (!alive.current) return;
      try {
        const next = await getProviderSwap(sw.id);
        if (finish(next)) return;
        sw = next;
      } catch { /* transient: keep following until the budget runs out */ }
    }
    if (alive.current) setOutcome({ kind: 'pending', swap: sw });
  }, [finish]);

  useEffect(() => {
    if (fired.current || !asset.data) return;
    fired.current = true;
    const pin = takeSwapPin();
    if (!pin) { backToReview(); return; } // reload / deep link: never confirm without a fresh PIN
    confirmM.mutate({ id: swapId, pin }, {
      onSuccess: (sw) => { void follow(sw); },
      onError: async (err) => {
        const code = swapErrorCode(err);
        if (isSwapPinError(code)) { backToReview(swapErrorMessage(code, side)); return; }
        // The confirm may have reached the provider before failing; the swap's own
        // state is the truth, so read it before telling the user anything.
        try {
          const sw = await getProviderSwap(swapId);
          if (sw.status !== 'quoted') { void follow(sw); return; } // past quoted: the confirm got somewhere
        } catch { /* fall through to the error screen */ }
        router.replace({
          pathname: `/crypto/${side}/failed`,
          params: { symbol, basis, amount, kind: code === 'quote_expired' ? 'quote_expired' : 'error', reason: swapErrorMessage(code, side) },
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.data]);

  if (outcome.kind === 'review' || outcome.kind === 'pending') {
    const review = outcome.kind === 'review';
    const held = side === 'buy' ? formatFiat(outcome.swap.totalKobo, 'NGN') : null;
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={[styles.ring, { backgroundColor: Colors.iconBgPurple }]}>
            {review ? <ShieldCheck size={44} color={Colors.primary} strokeWidth={2} /> : <Hourglass size={44} color={Colors.primary} strokeWidth={2} />}
          </View>
          <Text style={styles.title}>{review ? 'Your order is being checked' : 'Still processing'}</Text>
          <Text style={styles.sub}>
            {review
              ? side === 'buy'
                ? `Our partner didn't confirm this order in time. ${held} is held safely, not lost, while our team settles it — usually within one business day.`
                : "Our partner didn't confirm this sale in time. Our team will settle it — usually within one business day. You'll be credited if it went through."
              : side === 'buy'
                ? `Our partner is still filling this order. ${held} is held for it, and your portfolio updates as soon as it completes.`
                : 'Our partner is still completing this sale. Your wallet is credited as soon as it completes.'}
          </Text>
          <View style={styles.refCard}><Text style={styles.refText}>Reference {outcome.swap.id.slice(0, 8).toUpperCase()}</Text></View>
        </View>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Go to portfolio" onPress={() => router.dismissTo('/crypto/portfolio')} />
        </SafeAreaView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.ring}><ActivityIndicator size="large" color={Colors.primary} /></View>
        <Text style={styles.title}>{side === 'buy' ? 'Placing your order…' : 'Selling…'}</Text>
        <Text style={styles.sub}>Checking your PIN and sending this to our crypto partner. Please keep the app open.</Text>
      </View>
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
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowTotal: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, marginTop: Spacing.xs, paddingTop: Spacing.sm },
  rowKey: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowKeyTotal: { ...Typography.labelLg, color: Colors.onSurface },
  rowVal: { ...Typography.bodyMd, color: Colors.onSurface },
  rowValTotal: { ...Typography.titleMd, color: Colors.onSurface },
  footnote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm, lineHeight: 18 },
  pinHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  pinTitle: { ...Typography.titleMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  refCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8, marginTop: Spacing.sm },
  refText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
