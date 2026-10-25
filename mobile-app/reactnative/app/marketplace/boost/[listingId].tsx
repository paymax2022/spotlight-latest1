// Registered href:null in the marketplace tabs layout. Two modes on one route so
// no new tab-level route is added (screen 17 is "reuse: transaction-status"):
//   • no ?boostId  → Boost purchase: pick a length (preset day chips or a custom
//     end moment), priced by the admin's live ₦/day rate, inline wallet balance,
//     select → confirm → POST /boosts (Idempotency-Key) via the shared
//     PaymentSheet/usePurchasePayment. Insufficient balance → top-up link.
//     reason-coded rejection with instant auto-refund state.
// just-completed purchase (status, via ?boostId).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { confirmAsync, alertAsync } from '@/lib/confirm';
import { X, Zap, Wallet, CheckCircle2, AlertTriangle, RefreshCw, ArrowUpRight, TrendingUp, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import DatePickerField from '@/components/DatePickerField';
import TimePickerField from '@/components/TimePickerField';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import { MarketColors, formatNaira } from '@/features/marketplace';
import type { Boost } from '@/features/marketplace';
import { useBoostPricing, useBoost, useBoostQuote, usePurchaseBoost, useCancelBoost } from '@/features/marketplace/sell.hooks';

function track(event: string, props: Record<string, unknown>) {
  if (__DEV__) console.log(`[analytics] ${event}`, props);
}

export default function BoostRoute() {
  const { listingId, boostId } = useLocalSearchParams<{ listingId: string; boostId?: string }>();
  // A boostId (from the URL, or set locally after purchase) switches to status mode.
  const [localBoostId, setLocalBoostId] = useState<string | undefined>(boostId);
  const activeBoostId = boostId ?? localBoostId;

  if (activeBoostId) return <BoostStatus boostId={activeBoostId} />;
  return <BoostPurchase listingId={listingId ?? ''} onPurchased={setLocalBoostId} />;
}

// One number prices every boost: the admin's ₦/day rate, read live from the
// server (GET /boosts/pricing). Pick a length — the presets are one-tap shortcuts,
// a custom end moment is billed in whole days rounded UP — and the screen shows
// the arithmetic ("7 days × ₦100/day = ₦700") before the seller commits. This is
// the same ComputeBoostQuote the purchase itself runs server-side, so the price
// here and what the wallet is charged can never drift.
function BoostPurchase({ listingId, onPurchased }: { listingId: string; onPurchased: (id: string) => void }) {
  const pricingQuery = useBoostPricing();
  const purchaseBoost = usePurchaseBoost(listingId);
  const pay = usePurchasePayment<Boost>();
  const [mode, setMode] = useState<'duration' | 'custom'>('duration');
  const [selectedDays, setSelectedDays] = useState<number | null>(null);
  const [endDate, setEndDate] = useState<string | undefined>(); // YYYY-MM-DD
  const [endTime, setEndTime] = useState<string | undefined>();

  const dailyRateKobo = pricingQuery.data?.dailyRateKobo ?? 0;
  const presetDays = pricingQuery.data?.presetDurationDays ?? [];

  // Combine the date+time pickers into an ISO timestamp once both are set.
  // Local time is what the user actually picked ("6pm on the 12th"), so this
  // constructs a Date in the device's own timezone rather than parsing as UTC.
  const customEndsAt = React.useMemo(() => {
    if (!endDate || !endTime) return undefined;
    const [y, m, d] = endDate.split('-').map(Number);
    const [h, min] = endTime.split(':').map(Number);
    const dt = new Date(y, m - 1, d, h, min, 0, 0);
    return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
  }, [endDate, endTime]);

  // A whole-day boost is priced by plain multiplication the server repeats
  // identically, so a preset tap needs no round trip. Only a custom end moment
  // needs the quote — to learn how many whole days it rounds UP to.
  const customQuote = useBoostQuote(mode === 'custom' ? { endsAt: customEndsAt } : {});

  const durationDays = mode === 'duration' ? selectedDays ?? undefined : customQuote.data?.durationDays;
  const priceKobo = mode === 'duration'
    ? (selectedDays == null ? undefined : selectedDays * dailyRateKobo)
    : customQuote.data?.priceKobo;
  const canConfirm = mode === 'duration' ? selectedDays != null : !!customQuote.data && !customQuote.isError;

  // NO pre-flight affordability gate here, deliberately.
  // usePurchasePayment fetches the wallet balance with `enabled: visible`, so it
  // only runs once the payment sheet opens. A disabled React Query reports
  // isLoading === false, so a `!walletLoading && walletKobo < price` check read a
  // balance of 0 that had never been fetched and declared EVERY option unaffordable
  // — the button was permanently disabled no matter how much was in the wallet.
  // wallet OR card, and blocking on the wallet balance alone denied a user who
  // intended to pay by card. The sheet knows the real balance, offers both rails,
  // and the server enforces the debit — none of which needs this screen to guess
  // first.

  const handleConfirm = () => {
    if (!canConfirm || !listingId || !priceKobo) return;
    const selection = mode === 'duration' ? { durationDays: selectedDays as number } : { endsAt: customEndsAt as string };
    pay.start({
      amountKobo: priceKobo,
      title: `Boost — ${durationDays} day${durationDays === 1 ? '' : 's'}`,
      domain: 'marketplace_boost',
      // The boost is created (wallet debit + Idempotency-Key) only after the
      // payment rail confirms; the resulting Boost flows into onPaid.
      charge: async () => purchaseBoost.mutateAsync(selection),
      onPaid: (boost) => {
        track('boost_purchased', { listing_id: listingId, mode, ...selection, price_kobo: priceKobo, boost_id: boost.id });
        onPurchased(boost.id);
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Boost your listing</Text>
        <Pressable onPress={() => goBack('/marketplace')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close">
          <X size={22} color={Colors.onSurface} />
        </Pressable>
      </View>

      {pricingQuery.isLoading ? (
        <View style={styles.scroll}>{[0, 1, 2].map((i) => <View key={i} style={styles.tierSkeleton} />)}</View>
      ) : pricingQuery.isError ? (
        <StateView kind="error" title="Couldn't load boost pricing" actionLabel="Retry" onAction={() => pricingQuery.refetch()} />
      ) : (
        <>
          {/* Only state a balance once one has actually been fetched — the query is
              idle until the sheet opens, and rendering formatNaira(0) told the
              seller their wallet was empty when it was not. */}
          <View style={styles.walletRow}>
            <Wallet size={16} color={MarketColors.muted} />
            <Text style={styles.walletText}>
              {pay.walletLoading ? (
                <>Wallet balance: <Text style={styles.walletAmount}>…</Text></>
              ) : pay.walletKobo > 0 ? (
                <>Wallet balance: <Text style={styles.walletAmount}>{formatNaira(pay.walletKobo)}</Text></>
              ) : (
                <>Pay with your wallet or card at checkout</>
              )}
            </Text>
          </View>

          <View style={styles.segmentRow}>
            <Pressable style={[styles.segment, mode === 'duration' && styles.segmentActive]} onPress={() => setMode('duration')}>
              <Text style={[styles.segmentText, mode === 'duration' && styles.segmentTextActive]}>How long</Text>
            </Pressable>
            <Pressable style={[styles.segment, mode === 'custom' && styles.segmentActive]} onPress={() => setMode('custom')}>
              <Text style={[styles.segmentText, mode === 'custom' && styles.segmentTextActive]}>Until a date</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.rateNote}>
              Every boost costs <Text style={styles.rateStrong}>{formatNaira(dailyRateKobo)} a day</Text> — the{' '}
              {mode === 'duration' ? 'length you pick below sets the price' : 'end date you pick, rounded up to whole days, sets it'}.
            </Text>

            {mode === 'duration' ? (
              <>
                <View style={styles.daysRow}>
                  {presetDays.map((d) => {
                    const active = selectedDays === d;
                    return (
                      <Pressable key={d} style={[styles.dayChip, active && styles.dayChipActive]} onPress={() => setSelectedDays(d)}>
                        <Text style={[styles.dayChipDays, active && styles.dayChipDaysActive]}>{d} day{d === 1 ? '' : 's'}</Text>
                        <Text style={styles.dayChipPrice}>{formatNaira(d * dailyRateKobo)}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {selectedDays != null && (
                  <View style={styles.quoteBox}>
                    <Text style={styles.quoteText}>
                      {selectedDays} day{selectedDays === 1 ? '' : 's'} × {formatNaira(dailyRateKobo)}/day = <Text style={styles.quoteAmount}>{formatNaira(selectedDays * dailyRateKobo)}</Text>
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.customCard}>
                <View style={styles.customRow}>
                  <Text style={styles.customLabel}>Starts</Text>
                  <Text style={styles.customNow}>Now</Text>
                </View>
                <DatePickerField label="Ends — date" value={endDate} onChange={setEndDate} minYear={new Date().getFullYear()} maxYear={new Date().getFullYear() + 1} />
                <TimePickerField label="Ends — time" value={endTime} onChange={setEndTime} />

                {customEndsAt && customQuote.isLoading ? (
                  <Text style={styles.quoteHint}>Calculating fee…</Text>
                ) : customQuote.isError ? (
                  <Text style={styles.quoteError}>{(customQuote.error as { message?: string })?.message ?? 'Pick an end date in the future.'}</Text>
                ) : customQuote.data ? (
                  <View style={styles.quoteBox}>
                    <Text style={styles.quoteText}>
                      {customQuote.data.durationDays} day{customQuote.data.durationDays === 1 ? '' : 's'} × {formatNaira(customQuote.data.dailyRateKobo)}/day = <Text style={styles.quoteAmount}>{formatNaira(customQuote.data.priceKobo)}</Text>
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.quoteHint}>Pick an end date and time to see the fee.</Text>
                )}
              </View>
            )}

            <Text style={styles.disclaimer}>
              Boosts add extra visibility on top of relevance, trust, and freshness — they never override quality or trust scoring in results.
            </Text>
            <View style={{ height: 120 }} />
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={priceKobo ? `Boost for ${formatNaira(priceKobo)}` : mode === 'duration' ? 'Select a length' : 'Pick an end date'}
              onPress={handleConfirm}
              disabled={!canConfirm || pay.phase === 'charging' || pay.phase === 'awaiting'}
              loading={pay.phase === 'charging' || pay.phase === 'awaiting' || purchaseBoost.isPending}
            />
          </View>
        </>
      )}

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

function BoostStatus({ boostId }: { boostId: string }) {
  const boostQuery = useBoost(boostId);
  const cancelBoost = useCancelBoost();
  const [remaining, setRemaining] = useState('');

  const boost = boostQuery.data;
  const endsAt = boost?.endsAt ?? null;

  const handleStopBoost = async () => {
    if (!boost) return;
    const estimate = estimateProratedRefund(boost);
    const ok = await confirmAsync({
      title: 'Stop this boost?',
      message: estimate > 0
        ? `Your listing will stop being promoted right away. You'll get back about ${formatNaira(estimate)} for the days you haven't used yet.`
        : "Your listing will stop being promoted right away. There's nothing left to refund — the boost has essentially run its course.",
      confirmLabel: 'Stop boost',
      destructive: true,
    });
    if (!ok) return;
    try {
      await cancelBoost.mutateAsync(boost.id);
    } catch (e) {
      await alertAsync({ title: 'Could not stop boost', message: e instanceof Error ? e.message : 'Please try again.' });
    }
  };

  // Live countdown for an active boost.
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const ms = new Date(endsAt).getTime() - Date.now();
      if (ms <= 0) { setRemaining('Ended'); return; }
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setRemaining(d > 0 ? `${d}d ${h}h left` : `${h}h ${m}m left`);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [endsAt]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Boost status</Text>
        <Pressable onPress={() => router.replace('/marketplace/sell' as never)} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close">
          <X size={22} color={Colors.onSurface} />
        </Pressable>
      </View>

      {boostQuery.isLoading ? (
        <View style={styles.scroll}><View style={styles.statusSkeleton} /></View>
      ) : boostQuery.isError || !boost ? (
        <StateView kind="error" title="Couldn't load boost" actionLabel="Retry" onAction={() => boostQuery.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {boost.status === 'rejected_with_reason' ? (
            <RejectedState boost={boost} />
          ) : boost.status === 'auto_refunded' ? (
            boost.rejectionReasonCode === 'seller_cancelled'
              ? <CancelledState boost={boost} />
              : <RejectedState boost={boost} />
          ) : (
            <ActiveState boost={boost} remaining={remaining} onStop={handleStopBoost} stopping={cancelBoost.isPending} />
          )}
          <View style={styles.footer2}>
            <PrimaryButton label="Back to my listings" variant="secondary" onPress={() => router.replace('/marketplace/sell' as never)} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// estimateProratedRefund mirrors the backend's proratedBoostRefund (service_boost.go)
// for display only — the authoritative amount is whatever CancelBoost actually
// posts and returns as refundedKobo. Used to preview "about ₦X back" before the
// seller confirms stopping the boost.
function estimateProratedRefund(boost: Boost): number {
  if (!boost.startsAt || !boost.endsAt || boost.priceKobo <= 0) return 0;
  const total = new Date(boost.endsAt).getTime() - new Date(boost.startsAt).getTime();
  if (total <= 0) return 0;
  const remaining = Math.max(0, Math.min(total, new Date(boost.endsAt).getTime() - Date.now()));
  return Math.floor(boost.priceKobo * (remaining / total));
}

// formatDateTime shows both the date and the clock time. InfoRow previously
// used toLocaleDateString() alone, so "Started"/"Ends" never told the seller
// WHEN on that day the boost actually starts or ends — for a boost bought via
// the custom end-time picker, that time is exactly the thing they chose.
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function ActiveState({ boost, remaining, onStop, stopping }: { boost: Boost; remaining: string; onStop: () => void; stopping: boolean }) {
  // boost.status is the SERVER's last-known state, and nothing here flips it
  // active -> completed the instant ends_at passes — that transition needs a
  // background job to run. So a boost can sit at status: 'active' long after
  // its end time, and reading status alone produced a header reading "Boost
  // active" directly above a subtitle already reading "Ended", from the SAME
  // screen, at the SAME time. `remaining` is computed from ends_at against
  // the current clock every tick (see the countdown effect above), which is
  // the one place on this screen that already knows the boost is over — so
  // the header now reads from that, not from the stale server status.
  const ended = remaining === 'Ended';

  // Performance delta stub — with no baseline in the payload, present a plain
  // placeholder rather than an invented number.
  return (
    <>
      <View style={styles.statusHero}>
        <View style={styles.statusIcon}><Zap size={28} color={MarketColors.brand} /></View>
        <Text style={styles.statusTitle}>{ended ? 'Boost ended' : 'Boost active'}</Text>
        {/* statusSub carries textTransform: 'capitalize' (see styles below), built
            for short label-style text like "7 days" or "2d 5h left" — a full
            sentence there title-cases every word. Kept short to match. */}
        <Text style={styles.statusSub}>{ended ? 'Ran its course' : (remaining || `${boost.durationDays} days`)}</Text>
      </View>

      <View style={styles.deltaCard}>
        <View style={styles.deltaRow}>
          <TrendingUp size={18} color={MarketColors.ok} />
          <Text style={styles.deltaLabel}>Performance since boost</Text>
        </View>
        <Text style={styles.deltaHint}>We'll show views lifted vs. your baseline here as they come in.</Text>
      </View>

      <InfoRow label="Duration" value={`${boost.durationDays} days`} />
      <InfoRow label="Amount paid" value={formatNaira(boost.priceKobo)} />
      <InfoRow label="Started" value={boost.startsAt ? formatDateTime(boost.startsAt) : '—'} />
      {/* Always rendered, even with no value: a missing end date used to make
          this whole row disappear, which reads as "the app forgot the field"
          rather than "the field is genuinely empty" — the second is something
          a seller can report, the first just looks broken. */}
      <InfoRow label="Ends" value={boost.endsAt ? formatDateTime(boost.endsAt) : '—'} />

      {/* Nothing left to stop once it has already ended. */}
      {!ended && (
        <Pressable style={styles.retryRow} onPress={onStop} disabled={stopping} accessibilityRole="button">
          <XCircle size={16} color={MarketColors.danger} />
          <Text style={[styles.retryText, { color: MarketColors.danger }]}>{stopping ? 'Stopping…' : 'Stop boost'}</Text>
        </Pressable>
      )}
    </>
  );
}

function CancelledState({ boost }: { boost: Boost }) {
  const refunded = boost.refundedKobo ?? 0;
  return (
    <>
      <View style={styles.statusHero}>
        <View style={[styles.statusIcon, styles.statusIconWarn]}><XCircle size={28} color={MarketColors.warnText} /></View>
        <Text style={styles.statusTitle}>Boost stopped</Text>
        <Text style={styles.statusSub}>You cancelled this boost early</Text>
      </View>

      <View style={styles.refundCard}>
        <CheckCircle2 size={18} color={MarketColors.ok} />
        <Text style={styles.refundText}>
          {refunded > 0
            ? `${formatNaira(refunded)} for the unused days was automatically refunded to your wallet.`
            : 'The boost had essentially run its course, so there was nothing left to refund.'}
        </Text>
      </View>

      <InfoRow label="Duration" value={`${boost.durationDays} days`} />
      <InfoRow label="Amount paid" value={formatNaira(boost.priceKobo)} />
      <InfoRow label="Amount refunded" value={formatNaira(refunded)} />
    </>
  );
}

function RejectedState({ boost }: { boost: Boost }) {
  const reason = (boost.rejectionReasonCode ?? 'policy_review')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <>
      <View style={styles.statusHero}>
        <View style={[styles.statusIcon, styles.statusIconWarn]}><AlertTriangle size={28} color={MarketColors.warnText} /></View>
        <Text style={styles.statusTitle}>Boost not approved</Text>
        <Text style={styles.statusSub}>{reason}</Text>
      </View>

      <View style={styles.refundCard}>
        <CheckCircle2 size={18} color={MarketColors.ok} />
        <Text style={styles.refundText}>
          {formatNaira(boost.priceKobo)} was automatically refunded to your wallet — no action needed.
        </Text>
      </View>

      <Pressable style={styles.retryRow} onPress={() => router.replace(`/marketplace/boost/${boost.listingId}` as never)} accessibilityRole="button">
        <RefreshCw size={16} color={MarketColors.brand} />
        <Text style={styles.retryText}>Fix the listing and try boosting again</Text>
        <ArrowUpRight size={16} color={MarketColors.brand} />
      </Pressable>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xs },
  walletText: { ...Typography.labelMd, color: MarketColors.muted },
  walletAmount: { color: MarketColors.text, fontWeight: '700' },
  segmentRow: { flexDirection: 'row', marginHorizontal: Spacing.containerMargin, backgroundColor: MarketColors.surfaceAlt, borderRadius: Radius.md, padding: 3, gap: 3 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: Radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: MarketColors.surface, ...shadow1 },
  segmentText: { ...Typography.labelMd, color: MarketColors.muted, fontWeight: '600' },
  segmentTextActive: { color: MarketColors.brand },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.sm },
  customCard: { borderWidth: 1.5, borderColor: MarketColors.border, borderRadius: Radius.lg, padding: Spacing.cardPadding, backgroundColor: MarketColors.surface, ...shadow1 },
  customRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  customLabel: { ...Typography.labelMd, color: MarketColors.muted },
  customNow: { ...Typography.bodyMd, color: MarketColors.text, fontWeight: '700' },
  quoteHint: { ...Typography.labelSm, color: MarketColors.muted, marginTop: Spacing.xs },
  quoteError: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  quoteBox: { backgroundColor: MarketColors.okBg, borderRadius: Radius.md, padding: Spacing.sm, marginTop: Spacing.xs },
  quoteText: { ...Typography.bodySm, color: MarketColors.text },
  quoteAmount: { ...Typography.titleMd, color: MarketColors.brand, fontWeight: '800' },
  rateNote: { ...Typography.labelMd, color: MarketColors.muted },
  rateStrong: { color: MarketColors.text, fontWeight: '800' },
  daysRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  dayChip: { flexBasis: '30%', flexGrow: 1, minWidth: 96, alignItems: 'center', gap: 2, paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: MarketColors.border, backgroundColor: MarketColors.surface, ...shadow1 },
  dayChipActive: { borderColor: MarketColors.brand, backgroundColor: MarketColors.okBg },
  dayChipDays: { ...Typography.titleMd, color: MarketColors.text, fontWeight: '700' },
  dayChipDaysActive: { color: MarketColors.brand },
  dayChipPrice: { ...Typography.labelSm, color: MarketColors.muted },
  tierSkeleton: { height: 104, borderRadius: Radius.lg, backgroundColor: MarketColors.surfaceAlt, marginBottom: Spacing.sm },
  statusSkeleton: { height: 180, borderRadius: Radius.lg, backgroundColor: MarketColors.surfaceAlt },
  topupBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: MarketColors.warnBg, borderRadius: Radius.md, padding: Spacing.md },
  topupText: { ...Typography.labelMd, color: MarketColors.warnText, flex: 1 },
  topupLink: { fontWeight: '800' },
  disclaimer: { ...Typography.labelSm, color: MarketColors.muted, marginTop: Spacing.md, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
  footer2: { marginTop: Spacing.lg },
  // status
  statusHero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  statusIcon: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: MarketColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  statusIconWarn: { backgroundColor: MarketColors.warnBg },
  statusTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  statusSub: { ...Typography.bodyMd, color: MarketColors.muted, textTransform: 'capitalize' },
  deltaCard: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, padding: Spacing.md, gap: 6 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deltaLabel: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  deltaHint: { ...Typography.labelSm, color: MarketColors.muted },
  refundCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: MarketColors.okBg, borderRadius: Radius.lg, padding: Spacing.md },
  refundText: { ...Typography.labelMd, color: MarketColors.ok, flex: 1, fontWeight: '600' },
  retryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  retryText: { ...Typography.labelMd, color: MarketColors.brand, flex: 1, fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: MarketColors.border },
  infoLabel: { ...Typography.labelMd, color: MarketColors.muted },
  infoValue: { ...Typography.labelMd, color: MarketColors.text, fontWeight: '600', textTransform: 'capitalize' },
});
