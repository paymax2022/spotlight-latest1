import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Zap, CircleCheck, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { generateIdempotencyKey } from '@/utils/idempotency';
import {
  useBoostOffer,
  useDiscoveryTier,
  usePurchaseBoost,
} from '@/features/connect/discovery/hooks';
import type {
  Boost,
  BoostPurchaseResult,
  DiscoveryTierStatus,
} from '@/features/connect/discovery/types';
import type { TierStatus } from '@/features/connect/types/connect.types';

/**
 * Boost / Spotlight purchase (PRD §10.2 DC-08). Wallet-funded MONEY surface:
 *  - tier + remaining daily limit is rendered up top (money-surface invariant);
 *  - the purchase runs through the shared PaymentSheet (wallet OR Paystack card),
 *    exactly like gifting / spray / transport;
 *  - the wallet is charged in kobo with a FRESH Idempotency-Key per attempt so a
 *    double-tap or retry can never double-charge (iron rule).
 * Contract: GET /discovery/boosts → { activeBoost?, priceKobo, durationMinutes };
 *           POST /discovery/boosts (Idempotency-Key) → { boost }.
 */
function mapTier(t: DiscoveryTierStatus): TierStatus {
  return {
    tier: t.tier,
    label: t.label,
    dailyLimitKobo: t.dailyLimitKobo,
    remainingKobo: t.remainingKobo,
    canSend: true,
    canReceive: true,
    canWithdraw: true,
    canGoLive: true,
  };
}

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

export default function BoostScreen() {
  const offerQuery = useBoostOffer();
  const tierQuery = useDiscoveryTier();
  const purchase = usePurchaseBoost();
  const pay = usePurchasePayment<BoostPurchaseResult>();

  // The active boost, set from the offer's activeBoost or the just-purchased one.
  const [purchased, setPurchased] = useState<Boost | null>(null);

  const offer = offerQuery.data ?? null;
  const activeBoost = purchased ?? offer?.activeBoost ?? null;

  const tierStatus = useMemo(
    () => (tierQuery.data ? mapTier(tierQuery.data) : null),
    [tierQuery.data],
  );

  function onBuy() {
    if (!offer) return;
    // Mint ONE Idempotency-Key for this purchase attempt; the same key rides the
    // wallet charge so a retry (wallet or card fallback) is idempotent server-side.
    const idemKey = generateIdempotencyKey();
    pay.start({
      amountKobo: offer.priceKobo,
      title: 'Buy Boost',
      domain: 'connect_boost',
      charge: () => purchase.mutateAsync(idemKey),
      onPaid: (result) => setPurchased(result.boost),
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScreenHeader title="Boost" />

      {offerQuery.isLoading || tierQuery.isLoading ? (
        <StateView kind="loading" message="Loading boost…" />
      ) : offerQuery.isError || tierQuery.isError ? (
        <StateView
          kind="error"
          title="Couldn't load boost"
          message="Please try again."
          icon="CloudOff"
          actionLabel="Retry"
          onAction={() => {
            offerQuery.refetch();
            tierQuery.refetch();
          }}
        />
      ) : !offer ? (
        <StateView
          kind="empty"
          title="Boost unavailable"
          message="Check back soon."
          icon="Zap"
        />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {tierStatus ? (
              <View style={styles.tierWrap}>
                <TierLimitBar tier={tierStatus} />
              </View>
            ) : null}

            {activeBoost ? (
              <View style={styles.activeCard}>
                <CircleCheck size={28} color={ConnectColors.ok} strokeWidth={2} />
                <Text style={styles.activeTitle}>Boost active</Text>
                <View style={styles.activeMetaRow}>
                  <Clock size={14} color={ConnectColors.muted} strokeWidth={2} />
                  <Text style={styles.activeMeta}>
                    Active until {formatExpiry(activeBoost.expiresAt)}
                  </Text>
                </View>
              </View>
            ) : null}

            {purchase.isError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>
                  {purchase.error instanceof Error
                    ? purchase.error.message
                    : 'Purchase failed. Please try again.'}
                </Text>
              </View>
            ) : null}

            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Zap size={30} color={ConnectColors.brand} strokeWidth={2.2} />
              </View>
              <Text style={styles.heroTitle}>Boost your profile</Text>
              <Text style={styles.heroCopy}>
                Jump to the front of the deck in your area for {offer.durationMinutes} minutes and
                get seen by far more people.
              </Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Price</Text>
                <Text style={styles.price}>{formatKobo(offer.priceKobo)}</Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Duration</Text>
                <Text style={styles.priceMeta}>{offer.durationMinutes} min</Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={
                activeBoost
                  ? 'Buy another boost'
                  : `Buy Boost — ${formatKobo(offer.priceKobo)}`
              }
              disabled={purchase.isPending || pay.phase === 'charging' || pay.phase === 'awaiting'}
              loading={purchase.isPending}
              onPress={onBuy}
            />
          </View>
        </>
      )}

      {/* Shared wallet / Paystack checkout — same flow as every other paid feature. */}
      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xl },
  tierWrap: { marginBottom: Spacing.xs },
  activeCard: {
    backgroundColor: ConnectColors.okBg,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  activeTitle: { ...Typography.titleMd, color: Colors.onSurface },
  activeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activeMeta: { ...Typography.labelSm, color: ConnectColors.muted },
  errorBanner: {
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  errorText: { ...Typography.labelMd, color: Colors.error },
  hero: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  heroCopy: { ...Typography.bodyMd, color: ConnectColors.muted, textAlign: 'center' },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: Spacing.xs,
  },
  priceLabel: { ...Typography.labelMd, color: ConnectColors.muted },
  price: { ...Typography.titleMd, color: ConnectColors.brand },
  priceMeta: { ...Typography.labelLg, color: Colors.onSurface },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
