import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Minus, Plus, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useOffer, useBookOffer } from '@/features/mobility/hooks/useEvent';
import { formatNaira } from '@/features/mobility/utils/mobilityFormatters';
import { usePurchasePayment, PaymentSheet } from '@/features/payments';
import type { MobilityError } from '@/features/mobility/types/mobility.types';

export default function BookOfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offer = useOffer(id);
  const book = useBookOffer();
  // Shared chooser: wallet OR card (Paystack top-up) → then the booking charge.
  const pay = usePurchasePayment<Awaited<ReturnType<typeof book.mutateAsync>>>();
  const [seats, setSeats] = useState(1);
  const [bundle, setBundle] = useState(false);
  const [ticketRef, setTicketRef] = useState('');
  const [err, setErr] = useState<MobilityError | null>(null);

  const o = offer.data;

  if (offer.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Book seats" /><StateView kind="loading" message="Loading offer…" /></SafeAreaView>
    );
  }
  if (offer.isError || !o) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Book seats" /><MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => offer.refetch()} /></SafeAreaView>
    );
  }

  const seatsLeft = Math.max(0, o.capacity - o.bookedCount);
  // total is the server per-seat fare × seats; the client only multiplies the
  // server-provided per-seat value for display — never computes a fare.
  const totalKobo = o.fareKobo * seats;
  const canSubmit = seats >= 1 && seats <= seatsLeft && !book.isPending && (!bundle || ticketRef.trim().length > 0);

  const onConfirm = () => {
    if (!canSubmit) return;
    setErr(null);
    pay.start({
      amountKobo: totalKobo,
      title: 'Pay for booking',
      // Existing wallet booking charge (with its Idempotency-Key) runs unchanged.
      charge: async () => {
        try {
          return await book.mutateAsync({ offerId: o.id, seats, ticketRef: bundle && ticketRef.trim() ? ticketRef.trim() : undefined });
        } catch (e) {
          // Preserve the on-screen "offer full" / payment-failed UX.
          setErr(e as MobilityError);
          throw e;
        }
      },
      onPaid: () => router.replace('/mobility/events/bookings'),
    });
  };

  const isFull = err?.status === 409 || (err?.code as string | undefined) === 'OFFER_FULL';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Book seats" subtitle={o.title} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {isFull ? (
          <MobilityEdgeState
            kind="empty"
            title="This offer is now full"
            message="All seats were booked while you were here. Pick another transport option."
            actionLabel="Back to offers"
            onAction={() => router.replace('/mobility/events')}
          />
        ) : (
          <>
            <Text style={styles.section}>Seats</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={() => setSeats((s) => Math.max(1, s - 1))} disabled={seats <= 1}>
                <Minus size={18} color={seats <= 1 ? Colors.outline : Colors.primary} strokeWidth={2.4} />
              </Pressable>
              <Text style={styles.stepValue}>{seats}</Text>
              <Pressable style={styles.stepBtn} onPress={() => setSeats((s) => Math.min(seatsLeft, s + 1))} disabled={seats >= seatsLeft}>
                <Plus size={18} color={seats >= seatsLeft ? Colors.outline : Colors.primary} strokeWidth={2.4} />
              </Pressable>
              <Text style={styles.stepHint}>{seatsLeft} seat{seatsLeft === 1 ? '' : 's'} left</Text>
            </View>

            <Pressable style={styles.bundleRow} onPress={() => setBundle((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: bundle }}>
              <View style={[styles.checkbox, bundle && styles.checkboxOn]}>{bundle && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bundleTitle}>Ticket + ride bundle</Text>
                <Text style={styles.bundleHint}>Link your event ticket to this ride.</Text>
              </View>
            </Pressable>
            {bundle && (
              <TextInputField label="Ticket reference" value={ticketRef} onChangeText={setTicketRef} placeholder="e.g. TIX-SPL-4821" autoCapitalize="characters" />
            )}

            <FareBreakdownCard
              fareKobo={totalKobo}
              title="Booking summary"
              showTrustNote
              rows={[
                { label: `Per seat`, valueKobo: o.fareKobo },
                { label: `Seats × ${seats}`, valueText: formatNaira(totalKobo), emphasize: true },
              ]}
            />

            {err && !isFull && (
              <MobilityEdgeState kind="paymentFailed" compact message={err.message} actionLabel="Try again" onAction={onConfirm} />
            )}
          </>
        )}
      </ScrollView>

      {!isFull && (
        <View style={styles.footer}>
          <PrimaryButton label={`Confirm · ${formatNaira(totalKobo)}`} onPress={onConfirm} loading={book.isPending} disabled={!canSubmit} />
        </View>
      )}

      {/* Shared wallet/card chooser — drives the booking charge above. */}
      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  section: { ...Typography.labelLg, color: Colors.onSurface },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.outlineVariant },
  stepValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const, minWidth: 24, textAlign: 'center' },
  stepHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  bundleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  bundleTitle: { ...Typography.labelLg, color: Colors.onSurface },
  bundleHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
