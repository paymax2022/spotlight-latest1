// ── Boost — purchase (16) + status (17) in one route ─────────────────────────
//
// Registered href:null in the marketplace tabs layout. Two modes on one route so
// no new tab-level route is added (screen 17 is "reuse: transaction-status"):
//   • no ?boostId  → Boost purchase: tiered options, Naira prices, inline wallet
//     balance, select → confirm → POST /boosts (Idempotency-Key) via the shared
//     PaymentSheet/usePurchasePayment. Insufficient balance → top-up link.
//   • ?boostId=…   → Boost status: active countdown + performance delta, OR a
//     reason-coded rejection with instant auto-refund state.
//
// Entry: My Listings "Boost" button (purchase); a boost-expiry notification or a
// just-completed purchase (status, via ?boostId).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X, Zap, Wallet, CheckCircle2, AlertTriangle, RefreshCw, ArrowUpRight, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import DatePickerField from '@/components/DatePickerField';
import TimePickerField from '@/components/TimePickerField';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import { MarketColors, formatNaira } from '@/features/marketplace';
import type { Boost, BoostTier } from '@/features/marketplace';
import { useBoostTiers, useBoost, useBoostQuote, usePurchaseBoost } from '@/features/marketplace/sell.hooks';

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

// ── Screen 16 — Boost purchase ──
// Two ways to buy a boost, picked via the segmented control below:
//   • Package — a preset tier (unchanged from before: fixed duration/price).
//   • Custom  — pick an end date+time; starts now, fee = days (rounded up) ×
//     the admin-set ₦/day rate, previewed live via useBoostQuote before the
//     user commits (GET /boosts/quote — the SAME computation the purchase
//     itself uses server-side, so the price shown here is authoritative, not
//     a client-side guess).
function BoostPurchase({ listingId, onPurchased }: { listingId: string; onPurchased: (id: string) => void }) {
  const tiersQuery = useBoostTiers();
  const purchaseBoost = usePurchaseBoost(listingId);
  const pay = usePurchasePayment<Boost>();
  const [mode, setMode] = useState<'package' | 'custom'>('package');
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | undefined>(); // YYYY-MM-DD
  const [endTime, setEndTime] = useState<string | undefined>(); // HH:MM (24h)

  const tier = tiersQuery.data?.find((t) => t.tier === selectedTier);

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

  const customQuote = useBoostQuote(mode === 'custom' ? { endsAt: customEndsAt } : {});
  const priceKobo = mode === 'package' ? tier?.priceKobo : customQuote.data?.priceKobo;
  const durationDays = mode === 'package' ? tier?.durationDays : customQuote.data?.durationDays;
  const canConfirm = mode === 'package' ? !!selectedTier : !!customQuote.data && !customQuote.isError;

  // NO pre-flight affordability gate here, deliberately.
  //
  // usePurchasePayment fetches the wallet balance with `enabled: visible`, so it
  // only runs once the payment sheet opens. A disabled React Query reports
  // isLoading === false, so a `!walletLoading && walletKobo < price` check read a
  // balance of 0 that had never been fetched and declared EVERY tier unaffordable
  // — the button was permanently disabled no matter how much was in the wallet.
  //
  // It also hid the card rail: pay.start() passes no `method`, so the sheet offers
  // wallet OR card, and blocking on the wallet balance alone denied a user who
  // intended to pay by card. The sheet knows the real balance, offers both rails,
  // and the server enforces the debit — none of which needs this screen to guess
  // first.

  const handleConfirm = () => {
    if (!canConfirm || !listingId || !priceKobo) return;
    const selection = mode === 'package' ? { tier: tier!.tier } : { endsAt: customEndsAt! };
    pay.start({
      amountKobo: priceKobo,
      title: mode === 'package' ? `Boost — ${tier!.label}` : `Boost — ${durationDays} custom days`,
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

      {tiersQuery.isLoading ? (
        <View style={styles.scroll}>{[0, 1, 2].map((i) => <View key={i} style={styles.tierSkeleton} />)}</View>
      ) : tiersQuery.isError ? (
        <StateView kind="error" title="Couldn't load boost tiers" actionLabel="Retry" onAction={() => tiersQuery.refetch()} />
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
            <Pressable style={[styles.segment, mode === 'package' && styles.segmentActive]} onPress={() => setMode('package')}>
              <Text style={[styles.segmentText, mode === 'package' && styles.segmentTextActive]}>Packages</Text>
            </Pressable>
            <Pressable style={[styles.segment, mode === 'custom' && styles.segmentActive]} onPress={() => setMode('custom')}>
              <Text style={[styles.segmentText, mode === 'custom' && styles.segmentTextActive]}>Custom dates</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {mode === 'package' ? (
              (tiersQuery.data ?? []).map((t: BoostTier) => {
                const active = selectedTier === t.tier;
                return (
                  <Pressable key={t.tier} style={[styles.card, active && styles.cardActive]} onPress={() => setSelectedTier(t.tier)}>
                    <View style={styles.cardHead}>
                      <Zap size={18} color={active ? MarketColors.brand : MarketColors.muted} />
                      <Text style={[styles.tierLabel, active && styles.tierLabelActive]}>{t.label}</Text>
                      <Text style={styles.tierPrice}>{formatNaira(t.priceKobo)}</Text>
                    </View>
                    <Text style={styles.tierDesc}>{t.description}</Text>
                    <Text style={styles.tierDuration}>{t.durationDays} days of premium placement</Text>
                  </Pressable>
                );
              })
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
                      {customQuote.data.durationDays} day{customQuote.data.durationDays === 1 ? '' : 's'} × boost rate = <Text style={styles.quoteAmount}>{formatNaira(customQuote.data.priceKobo)}</Text>
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
              label={priceKobo ? `Boost for ${formatNaira(priceKobo)}` : mode === 'package' ? 'Select a tier' : 'Pick an end date'}
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

// ── Screen 17 — Boost status ──
function BoostStatus({ boostId }: { boostId: string }) {
  const boostQuery = useBoost(boostId);
  const [remaining, setRemaining] = useState('');

  const boost = boostQuery.data;
  const endsAt = boost?.endsAt ?? null;

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
          {boost.status === 'rejected_with_reason' || boost.status === 'auto_refunded' ? (
            <RejectedState boost={boost} />
          ) : (
            <ActiveState boost={boost} remaining={remaining} />
          )}
          <View style={styles.footer2}>
            <PrimaryButton label="Back to my listings" variant="secondary" onPress={() => router.replace('/marketplace/sell' as never)} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ActiveState({ boost, remaining }: { boost: Boost; remaining: string }) {
  // Performance delta stub — with no baseline in the payload, present a plain
  // placeholder rather than an invented number.
  return (
    <>
      <View style={styles.statusHero}>
        <View style={styles.statusIcon}><Zap size={28} color={MarketColors.brand} /></View>
        <Text style={styles.statusTitle}>Boost active</Text>
        <Text style={styles.statusSub}>{remaining || `${boost.durationDays} days`}</Text>
      </View>

      <View style={styles.deltaCard}>
        <View style={styles.deltaRow}>
          <TrendingUp size={18} color={MarketColors.ok} />
          <Text style={styles.deltaLabel}>Performance since boost</Text>
        </View>
        <Text style={styles.deltaHint}>We'll show views lifted vs. your baseline here as they come in.</Text>
      </View>

      <InfoRow label="Tier" value={boost.tier} />
      <InfoRow label="Duration" value={`${boost.durationDays} days`} />
      <InfoRow label="Amount paid" value={formatNaira(boost.priceKobo)} />
      {boost.startsAt ? <InfoRow label="Started" value={new Date(boost.startsAt).toLocaleDateString()} /> : null}
      {boost.endsAt ? <InfoRow label="Ends" value={new Date(boost.endsAt).toLocaleDateString()} /> : null}
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
  card: { borderWidth: 1.5, borderColor: MarketColors.border, borderRadius: Radius.lg, padding: Spacing.cardPadding, backgroundColor: MarketColors.surface, ...shadow1 },
  cardActive: { borderColor: MarketColors.brand, backgroundColor: MarketColors.okBg },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  tierLabel: { ...Typography.titleMd, color: MarketColors.text, flex: 1 },
  tierLabelActive: { color: MarketColors.brand },
  tierPrice: { ...Typography.titleMd, color: MarketColors.brand },
  tierDesc: { ...Typography.bodySm, color: MarketColors.muted, marginTop: 4 },
  tierDuration: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 4 },
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
