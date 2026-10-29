import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Tag, Users, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { PaymentSheet, usePurchasePayment, useGatewayCheckout } from '@/features/payments';
import { useEvent, useQuote, usePurchaseTickets } from '@/features/events/hooks';
import { initiateCardCheckout } from '@/features/events/api';
import { getErrorMessage } from '@/utils/errorMapper';
import {
  EventColors, formatNaira, EVENTS_CARD_CHECKOUT_ENABLED, EVENTS_COMMERCE_ENABLED,
} from '@/features/events/constants/events.constants';
import type { PurchaseResult } from '@/features/events/types';

// Mirrors backend MaxTicketsPerOrder and maxAttendeeNameLen: sending more than the
// server allows, or a name longer than the column, is a 400 the user can't fix.
const MAX_PER_ORDER = 10;
const MAX_NAME_LEN = 120;

export default function CheckoutReview() {
  const { eventId, tierId, qty } = useLocalSearchParams<{ eventId: string; tierId: string; qty: string }>();
  const quantity = Math.min(MAX_PER_ORDER, Math.max(1, parseInt(qty ?? '1', 10) || 1));

  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState('');
  const [nameSeatHolders, setNameSeatHolders] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);

  const { data: e, isLoading, isError, refetch } = useEvent(eventId ?? '');
  const purchase = usePurchaseTickets();
  const pay = usePurchasePayment<PurchaseResult>();
  const cardCheckout = useGatewayCheckout();
  // All hooks run before the early returns below. The quote is the server's own
  // arithmetic for this basket; the hook stays disabled while the commerce flag
  // is off, so this render costs one request at most.
  const quote = useQuote({ eventId: eventId ?? '', tier_id: tierId ?? '', quantity, promo_code: promo || undefined });

  // One field per seat, in ticket order — the server binds names to seats by
  // position, so the list has to track the quantity exactly.
  useEffect(() => {
    setNames((prev) => (prev.length === quantity ? prev : Array.from({ length: quantity }, (_, i) => prev[i] ?? '')));
  }, [quantity]);

  const quoteFailed = EVENTS_COMMERCE_ENABLED && quote.isError;
  const chargeAmount = useMemo(() => {
    if (EVENTS_COMMERCE_ENABLED) return quote.data?.total_kobo ?? 0;
    return (e?.tiers.find((t) => t.id === tierId)?.price_kobo ?? 0) * quantity;
  }, [EVENTS_COMMERCE_ENABLED, quote.data, e, tierId, quantity]);

  // Without commerce there is no /quote, so the server debits exactly
  // price x quantity and nothing is added on top: the disclosed total is the
  // charged amount. With commerce the quote replaces that arithmetic entirely.
  const withFee = EVENTS_COMMERCE_ENABLED && !!quote.data && quote.data.platform_fee_kobo > 0;
  const pricePending = EVENTS_COMMERCE_ENABLED && !quote.data && !quoteFailed;

  if (isLoading) return <Shell><StateView kind="loading" message="Loading order…" /></Shell>;
  if (isError || !e) return <Shell><StateView kind="error" title="Couldn't load order" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Shell>;

  const tier = e.tiers.find((t) => t.id === tierId);
  if (!tier) return <Shell><StateView kind="error" title="Ticket unavailable" message="Please pick a ticket tier again." actionLabel="Back" onAction={() => goBack('/events')} /></Shell>;

  const q = quote.data;
  const isFree = chargeAmount === 0;
  const seatsLeft = q ? q.remaining_seats : Math.max(0, tier.capacity - tier.sold);
  const notEnoughSeats = !!q && !q.unlimited_capacity && q.quantity > q.remaining_seats;
  const subtotalKobo = q?.subtotal_kobo ?? tier.price_kobo * quantity;
  const discountKobo = q?.discount_kobo ?? 0;

  const applyPromo = () => {
    setPromo(promoInput.trim().toUpperCase());
    setNameError(null);
  };

  const clearPromo = () => { setPromo(''); setPromoInput(''); };

  // Names are all-or-none: a half-named batch is a server-side 400, because it
  // would mis-attribute who the gate let in.
  const attendeeNames = (): string[] | undefined => {
    if (!EVENTS_COMMERCE_ENABLED || !nameSeatHolders) return undefined;
    const trimmed = names.map((n) => n.trim().slice(0, MAX_NAME_LEN));
    const filled = trimmed.filter(Boolean).length;
    if (filled === 0) return undefined;
    if (filled < quantity) {
      setNameError(`Name all ${quantity} seat${quantity > 1 ? 's' : ''} or leave them all blank.`);
      return undefined;
    }
    setNameError(null);
    return trimmed;
  };

  const done = (res: PurchaseResult) => {
    const issued = res.tickets?.length ?? quantity;
    const params: Record<string, string> = {
      count: String(issued),
      requested: String(quantity),
      eventId: e.id,
      charged: String(res.total_kobo ?? chargeAmount),
    };
    // booking_ref only exists with the commerce columns; without it the success
    // screen has no receipt to point at.
    if (res.booking_ref) params.ref = res.booking_ref;
    router.replace({ pathname: '/events/checkout/success', params });
  };

  const confirm = async () => {
    const attendees = attendeeNames();
    if (EVENTS_COMMERCE_ENABLED && nameSeatHolders && !attendees && names.some((n) => n.trim())) return;

    const input = { eventId: e.id, tier_id: tier.id, quantity, promo_code: promo || undefined, attendee_names: attendees };
    if (isFree) {
      const res = await purchase.mutateAsync(input);
      done(res);
      return;
    }
    pay.start({
      amountKobo: chargeAmount,
      title: `Pay for ${quantity} × ${q?.tier_name ?? tier.name}`,
      charge: () => purchase.mutateAsync(input),
      onPaid: done,
      // Direct card rail (server holds the seats + owns the transaction) —
      // behind FEATURE_EVENTS_CARD_CHECKOUT / EXPO_PUBLIC_EVENTS_CARD_CHECKOUT.
      // Off ⇒ the sheet falls back to its built-in wallet top-up card rail.
      onCard: EVENTS_CARD_CHECKOUT_ENABLED ? () => cardCheckout.start({
        domain: 'event_ticket',
        initialize: async ({ email }) => {
          const r = await initiateCardCheckout({ eventId: e.id, tier_id: tier.id, quantity, email });
          if (!r.authorizationUrl) throw new Error('Paystack did not return a payment URL.');
          return { authorizationUrl: r.authorizationUrl, reference: r.reference };
        },
        onResolved: (res) => {
          router.replace({ pathname: '/events/checkout/card/[reference]', params: { reference: res.reference, eventId: e.id } });
        },
      }) : undefined,
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review order" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.eventTitle}>{e.title}</Text>
          <Text style={styles.eventSub}>{q?.venue ?? e.venue}{q?.city || e.city ? ` · ${q?.city ?? e.city}` : ''}</Text>
          <Text style={styles.eventSub}>{new Date(q?.starts_at ?? e.starts_at).toLocaleString('en-NG', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
        </View>

        <View style={styles.card}>
          {pricePending ? (
            <Text style={styles.pricingNote}>Checking the current price…</Text>
          ) : quoteFailed ? (
            <View style={styles.quoteError}>
              <Text style={styles.quoteErrorText} accessibilityRole="alert">{getErrorMessage(quote.error)}</Text>
              <Pressable onPress={() => quote.refetch()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry price check">
                <Text style={styles.retry}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Row label={`${q?.tier_name ?? tier.name} × ${quantity}`} value={formatNaira(subtotalKobo)} />
              {discountKobo > 0 ? (
                <Row label={`Promo ${q?.promo_code ?? promo}`} value={`− ${formatNaira(discountKobo)}`} tone="ok" />
              ) : null}
              <View style={styles.divider} />
              <Row label="Total to pay" value={isFree ? 'Free' : formatNaira(chargeAmount)} bold />
              {withFee ? (
                <Text style={styles.feeNote}>
                  {formatNaira(q?.platform_fee_kobo ?? 0)} platform service fee is included in that total and is
                  deducted from the organiser's share. Nothing is added at payment.
                </Text>
              ) : null}
              {q && !q.unlimited_capacity ? (
                <Text style={styles.seatsNote}>{q.remaining_seats} seat{q.remaining_seats === 1 ? '' : 's'} left in this tier</Text>
              ) : null}
            </>
          )}
        </View>

        {EVENTS_COMMERCE_ENABLED ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}><Tag size={14} color={EventColors.brand} strokeWidth={2} /> Promo code</Text>
            <View style={styles.promoRow}>
              <View style={{ flex: 1 }}>
                <TextInputField
                  value={promoInput}
                  onChangeText={setPromoInput}
                  placeholder="Enter code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!pricePending}
                />
              </View>
              {promo ? (
                <Pressable onPress={clearPromo} hitSlop={8} style={styles.promoClear} accessibilityRole="button" accessibilityLabel="Remove promo code">
                  <Text style={styles.promoClearText}>Remove</Text>
                </Pressable>
              ) : (
                <Pressable onPress={applyPromo} disabled={!promoInput.trim()} style={[styles.promoApply, !promoInput.trim() && styles.promoApplyDisabled]} accessibilityRole="button" accessibilityLabel="Apply promo code">
                  <Text style={styles.promoApplyText}>Apply</Text>
                </Pressable>
              )}
            </View>
            {quoteFailed && promo ? (
              <Text style={styles.promoRejected}>This code wasn't accepted. Remove it to pay full price.</Text>
            ) : null}
          </View>
        ) : null}

        {EVENTS_COMMERCE_ENABLED ? (
          <View style={styles.card}>
            <Pressable
              onPress={() => { setNameSeatHolders((v) => !v); setNameError(null); }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: nameSeatHolders }}
              style={styles.toggleRow}
            >
              <View style={styles.toggleLeft}>
                <Users size={16} color={EventColors.brand} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Name the seat holders</Text>
                  <Text style={styles.cardSub}>Optional. Tickets are transferable only while unnamed, so the gate can check ID against the list.</Text>
                </View>
              </View>
              <Text style={styles.toggleValue}>{nameSeatHolders ? 'On' : 'Off'}</Text>
            </Pressable>
            {nameSeatHolders ? (
              <View style={styles.nameList}>
                {names.map((n, i) => (
                  <TextInputField
                    key={i}
                    label={`Seat ${i + 1}`}
                    value={n}
                    maxLength={MAX_NAME_LEN}
                    autoCapitalize="words"
                    placeholder="Full name"
                    onChangeText={(v) => {
                      setNameError(null);
                      setNames((prev) => prev.map((x, j) => (j === i ? v : x)));
                    }}
                  />
                ))}
                {nameError ? <Text style={styles.promoRejected} accessibilityRole="alert">{nameError}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {q?.refund_policy ? (
          <View style={styles.disclosure}>
            <Text style={styles.disclosureTitle}><ShieldCheck size={15} color={EventColors.brand} strokeWidth={2} /> Refund policy</Text>
            <Text style={styles.disclosureText}>{q.refund_policy}</Text>
            {q.refund_cutoff_hours ? <Text style={styles.disclosureText}>Refund requests close {q.refund_cutoff_hours} hours before the event starts.</Text> : null}
            {q.checkin_opens_minutes ? <Text style={styles.disclosureText}>The gate opens {q.checkin_opens_minutes} minutes before start{q.checkin_closes_minutes ? ` and closes ${q.checkin_closes_minutes} minutes after` : ''}.</Text> : null}
          </View>
        ) : null}

        <Text style={styles.note}>Tickets are issued instantly to your Paymax account. Amounts are in Naira.</Text>
        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.footer}>
        {notEnoughSeats ? (
          <Text style={styles.soldOutNote} accessibilityRole="alert">
            Only {q?.remaining_seats} seat{q?.remaining_seats === 1 ? '' : 's'} left — go back and pick a smaller quantity.
          </Text>
        ) : null}
        <PrimaryButton
          label={isFree ? 'Get free ticket' : `Pay ${formatNaira(chargeAmount)}`}
          loading={purchase.isPending}
          disabled={pricePending || quoteFailed || notEnoughSeats || chargeAmount < 0}
          onPress={confirm}
        />
      </View>

      <PaymentSheet controller={pay} />
      <cardCheckout.Sheet />
    </SafeAreaView>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: 'ok' }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.bold, tone === 'ok' && styles.rowOk]}>{value}</Text>
    </View>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Review order" />{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardSub: { ...Typography.caption, color: EventColors.muted, marginTop: 2 },
  eventTitle: { ...Typography.titleLg, color: Colors.onSurface },
  eventSub: { ...Typography.bodySm, color: EventColors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: EventColors.muted },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface, textAlign: 'right' },
  rowOk: { color: EventColors.ok },
  bold: { ...Typography.labelLg, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: 4 },
  feeNote: { ...Typography.caption, color: EventColors.muted, lineHeight: 18 },
  seatsNote: { ...Typography.caption, color: EventColors.warnText },
  pricingNote: { ...Typography.bodyMd, color: EventColors.muted },
  quoteError: { gap: Spacing.xs },
  quoteErrorText: { ...Typography.bodySm, color: EventColors.danger },
  retry: { ...Typography.labelMd, color: EventColors.brand, textDecorationLine: 'underline' },
  promoRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  promoApply: { paddingHorizontal: Spacing.lg, height: 56, borderRadius: Radius.lg, backgroundColor: EventColors.brand, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  promoApplyDisabled: { opacity: 0.5 },
  promoApplyText: { ...Typography.labelMd, color: Colors.onPrimary },
  promoClear: { height: 56, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  promoClearText: { ...Typography.labelMd, color: EventColors.danger, textDecorationLine: 'underline' },
  promoRejected: { ...Typography.caption, color: EventColors.danger },
  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  toggleLeft: { flex: 1, flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  toggleValue: { ...Typography.labelMd, color: EventColors.brand },
  nameList: { gap: 0, marginTop: Spacing.sm },
  disclosure: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.xs },
  disclosureTitle: { ...Typography.titleMd, color: Colors.onSurface },
  disclosureText: { ...Typography.bodySm, color: EventColors.muted, lineHeight: 20 },
  note: { ...Typography.bodySm, color: EventColors.muted, textAlign: 'center' },
  soldOutNote: { ...Typography.caption, color: EventColors.danger, marginBottom: Spacing.xs, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
