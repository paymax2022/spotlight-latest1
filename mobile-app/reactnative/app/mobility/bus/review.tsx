import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { User, Armchair, ArrowLeftRight, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBusDraft, useCreateBusBooking, initiateBusPaystack } from '@/features/mobility/hooks/useBusV2';
import { missingLegs, setBusDraftBooking } from '@/features/mobility/utils/busCheckoutDraft';
import { holdCountdownCopy, isHoldExpired, isSeatConflict, parseBusV2Error } from '@/features/mobility/utils/busV2';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import { useGatewayCheckout } from '@/features/payments';

const time = (iso: string) =>
  !iso || Number.isNaN(Date.parse(iso))
    ? '—'
    : new Date(iso).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Review — creates the pending-payment booking ONCE from the checkout draft
 * (Idempotency-Key = draft.bookIdemKey; a remount/refresh replays rather than
 * double-books), shows the SERVER-QUOTE fare breakdown only, then collects via
 * the server-initiated Paystack gateway (useGatewayCheckout — the contract's
 * POST /mobility/bus/paystack/initiate). No wallet charge happens here.
 */
export default function BusReviewScreen() {
  const draft = useBusDraft();
  const createBooking = useCreateBusBooking();
  const checkout = useGatewayCheckout();
  const attemptedKey = useRef<string | null>(null);

  const missing = missingLegs(draft);
  const ready = Boolean(draft && missing.length === 0 && draft.passengers.length > 0);

  // Create (or idempotently replay) the booking once per draft key.
  useEffect(() => {
    if (!ready || !draft || draft.bookingRef) return;
    if (attemptedKey.current === draft.bookIdemKey) return;
    attemptedKey.current = draft.bookIdemKey;
    const outbound = draft.legs.find((l) => l.direction === 'outbound') ?? draft.legs[0];
    createBooking.mutate(
      {
        holdId: outbound.holdId,
        legs: draft.legs.map((l) => ({
          departureId: l.departureId,
          holdId: l.holdId,
          seatIds: l.seatIds,
          fromSeq: l.fromSeq,
          toSeq: l.toSeq,
        })),
        passengers: draft.passengers,
        idempotencyKey: draft.bookIdemKey,
      },
      {
        onSuccess: (booking) => setBusDraftBooking(booking.bookingRef, booking.status, booking.quote),
      },
    );
  }, [ready, draft, createBooking]);

  const bookingRef = draft?.bookingRef ?? null;
  const quote = draft?.quote ?? null;

  const onPay = () => {
    if (!bookingRef || !quote) return;
    void checkout.start({
      domain: 'bus_booking',
      initialize: (ctx) => initiateBusPaystack(bookingRef, ctx.email),
      onResolved: () => router.replace(`/mobility/bus/ticket/${bookingRef}`),
    });
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review booking" />
        <StateView
          kind="empty"
          title="Nothing to review"
          message="Pick departures and seats first — the draft resets when a hold lapses."
          actionLabel="Back to search"
          onAction={() => goBack('/mobility/bus')}
        />
      </SafeAreaView>
    );
  }

  const d = draft!;

  if (createBooking.isError) {
    const { code, message } = parseBusV2Error(createBooking.error);
    const seatsGone = isHoldExpired(createBooking.error) || isSeatConflict(createBooking.error);
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review booking" />
        <MobilityEdgeState
          kind="genericError"
          title={seatsGone ? 'Seats need re-selecting' : 'Could not create the booking'}
          message={message}
          actionLabel={seatsGone ? 'Back to results' : 'Try again'}
          onAction={() => {
            if (seatsGone) goBack('/mobility/bus/results');
            else { attemptedKey.current = null; createBooking.reset(); }
          }}
        />
        <Text style={styles.codeHint}>{code !== 'UNKNOWN' ? `Error ${code}` : ''}</Text>
      </SafeAreaView>
    );
  }

  if (!bookingRef || !quote) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review booking" />
        <StateView kind="loading" message="Reserving your seats…" />
      </SafeAreaView>
    );
  }

  const holdDeadline = d.legs.map((l) => l.holdExpiresAt).filter(Boolean).sort()[0] ?? null;
  const holdCopy = holdCountdownCopy(holdDeadline);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review booking" subtitle={bookingRef} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {holdCopy ? (
          <View style={styles.holdBanner}>
            <AlertTriangle size={14} color={Colors.onWarning} strokeWidth={2.2} />
            <Text style={styles.holdBannerText}>{holdCopy}</Text>
          </View>
        ) : null}

        {d.legs.map((leg) => (
          <View key={leg.direction} style={styles.card}>
            <View style={styles.legHead}>
              <ArrowLeftRight size={14} color={Colors.secondary} strokeWidth={2.2} />
              <Text style={styles.legTitle}>{leg.direction === 'return' ? 'Return leg' : 'Outbound leg'}</Text>
            </View>
            <Text style={styles.legRoute}>{leg.summary.routeLabel}</Text>
            <Text style={styles.legMeta}>
              {leg.summary.operatorName} · {leg.summary.vehicleClass}
            </Text>
            <Text style={styles.legMeta}>
              {leg.summary.boardingAt ? `Boards ${time(leg.summary.boardingAt)} · ` : ''}Departs {time(leg.summary.departureAt)}
            </Text>
            <View style={styles.legSeats}>
              <Armchair size={13} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.legSeatsText}>Seats {leg.seatLabels.join(', ')} · {leg.summary.fromStopName} → {leg.summary.toStopName}</Text>
            </View>
          </View>
        ))}

        <View style={styles.card}>
          {d.passengers.map((p, i) => (
            <View key={i} style={styles.row}>
              <View style={styles.rowIcon}><User size={16} color={Colors.secondary} strokeWidth={2} /></View>
              <Text style={styles.rowLabel} numberOfLines={1}>{p.name}{p.isSelf ? ' (you)' : ''}</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{p.deliverTo === 'purchaser' ? 'Ticket to you' : 'Ticket to them'}</Text>
            </View>
          ))}
        </View>

        {/* Server quote ONLY — never recompute fares client-side. */}
        <FareBreakdownCard
          title="Fare breakdown"
          fareKobo={quote.totalKobo}
          rows={quote.lines.map((l) => ({ label: l.label, valueKobo: l.amountKobo }))}
          showTrustNote
        />
        <Text style={styles.payNote}>Payment is collected by Paystack — the booking stays held until the gateway confirms.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.fareRow}>
          <Text style={styles.fareLabel}>Total</Text>
          <Text style={styles.fareValue}>{formatNairaWhole(quote.totalKobo)}</Text>
        </View>
        {checkout.error ? <Text style={styles.errText}>{checkout.error}</Text> : null}
        <PrimaryButton
          label={checkout.phase === 'initializing' ? 'Starting secure checkout…' : 'Pay with Paystack'}
          onPress={onPay}
          loading={checkout.phase === 'initializing' || checkout.phase === 'awaiting'}
          disabled={checkout.phase === 'awaiting'}
        />
      </View>

      {/* Paystack gateway sheet (native WebView host; no-op on web). */}
      <checkout.Sheet />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  holdBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.sm },
  holdBannerText: { ...Typography.labelSm, color: Colors.onWarning, flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 4 },
  legHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legTitle: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.4 },
  legRoute: { ...Typography.titleMd, color: Colors.onSurface },
  legMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  legSeats: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  legSeatsText: { ...Typography.labelSm, color: Colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowIcon: { width: 30, height: 30, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  rowValue: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  payNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  errText: { ...Typography.labelSm, color: Colors.error },
  codeHint: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fareLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  fareValue: { ...Typography.headlineMd, color: Colors.primary, fontWeight: '800' as const },
});
