import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Minus, Plus, ArrowRight, Wallet, TriangleAlert, X } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow2 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import DateRangeCalendar, { pickRange } from '@/features/stays/components/DateRangeCalendar';
import { useTrip, useModifyQuote, useApplyModify, type ModifyQuote } from '@/features/stays/trips';
import { formatNaira, formatShortDate, nightsBetween } from '@/features/stays/constants/stays.constants';
import type { GuestConfig } from '@/features/stays/types';

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function ModifyBookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id ?? '');
  const quoteM = useModifyQuote();
  const applyM = useApplyModify();

  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState<GuestConfig | null>(null);
  const [quote, setQuote] = useState<ModifyQuote | null>(null);
  // The date picker's own selection, kept apart until the guest applies it.
  const [picking, setPicking] = useState<{ start: string | null; end: string | null } | null>(null);
  const [pickQuote, setPickQuote] = useState<ModifyQuote | null>(null);

  useEffect(() => {
    if (trip.data && !checkIn) {
      setCheckIn(trip.data.checkIn);
      setCheckOut(trip.data.checkOut);
      setGuests(trip.data.guests);
    }
  }, [trip.data, checkIn]);

  // Re-quote (re-prebook delta) whenever the selection changes.
  useEffect(() => {
    if (!id || !checkIn || !checkOut || !guests) return;
    setQuote(null);
    quoteM.mutate(
      { reservationId: id, checkIn, checkOut, guests },
      { onSuccess: (q) => setQuote(q) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkIn, checkOut, guests]);

  // Check availability for the range being picked, so the guest sees whether it can be
  // booked before they confirm it.
  useEffect(() => {
    if (!id || !guests || !picking?.start || !picking?.end || picking.end <= picking.start) {
      setPickQuote(null);
      return;
    }
    setPickQuote(null);
    quoteM.mutate(
      { reservationId: id, checkIn: picking.start, checkOut: picking.end, guests },
      { onSuccess: (q) => setPickQuote(q) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking?.start, picking?.end]);

  // Loading only while the trip is in flight or its guests are still being copied in;
  // an empty result falls through to "Booking not found" instead of spinning forever.
  if (trip.isLoading || (trip.data && !guests)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Modify booking" />
        <StateView kind="loading" message="Loading your booking…" />
      </SafeAreaView>
    );
  }
  if (trip.isError || !trip.data || !guests) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Modify booking" />
        <StateView kind="error" title="Booking not found" actionLabel="My bookings" onAction={() => router.replace('/stays/trips')} />
      </SafeAreaView>
    );
  }

  const nights = nightsBetween(checkIn, checkOut);
  const delta = quote?.deltaKobo ?? 0;
  const charge = delta > 0;
  const refund = delta < 0;
  const pickedNights = picking?.start && picking?.end ? nightsBetween(picking.start, picking.end) : 0;

  function setAdults(n: number) {
    setGuests((g) => (g ? { ...g, adults: Math.max(1, n) } : g));
  }

  // Steppers keep the stay valid: check-in stays at least one night before check-out, and
  // check-out stays at least one night after check-in.
  function stepCheckIn(days: number) {
    const next = shift(checkIn, days);
    if (next < checkOut) setCheckIn(next);
  }

  function stepCheckOut(days: number) {
    const next = shift(checkOut, days);
    if (next > checkIn) setCheckOut(next);
  }

  function openPicker() {
    setPicking({ start: checkIn, end: checkOut });
  }

  function applyPicking() {
    if (!picking?.start || !picking?.end || picking.end <= picking.start) return;
    setCheckIn(picking.start);
    setCheckOut(picking.end);
    setPicking(null);
  }

  function onApply() {
    if (!id || !quote || quote.unavailable) return;
    applyM.mutate(
      { reservationId: id, checkIn, checkOut, guests: guests! },
      { onSuccess: () => router.replace({ pathname: '/stays/trips/[id]', params: { id } }) },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Modify booking" subtitle="Re-prebook delta via wallet" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.label}>Dates</Text>
          <View style={styles.dateRow}>
            <Pressable style={styles.dateBox} onPress={openPicker} accessibilityLabel="Pick check-in date">
              <Text style={styles.dateLabel}>Check-in</Text>
              <Text style={styles.dateVal}>{formatShortDate(checkIn)}</Text>
            </Pressable>
            <ArrowRight size={18} color={Colors.onSurfaceVariant} />
            <Pressable style={styles.dateBox} onPress={openPicker} accessibilityLabel="Pick check-out date">
              <Text style={styles.dateLabel}>Check-out</Text>
              <Text style={styles.dateVal}>{formatShortDate(checkOut)}</Text>
            </Pressable>
          </View>
          <View style={styles.dateRow}>
            <View style={styles.dateBox}>
              <Stepper onMinus={() => stepCheckIn(-1)} onPlus={() => stepCheckIn(1)} />
            </View>
            <View style={{ width: 18 }} />
            <View style={styles.dateBox}>
              <Stepper onMinus={() => stepCheckOut(-1)} onPlus={() => stepCheckOut(1)} />
            </View>
          </View>
          <Text style={styles.nights}>{nights} night{nights > 1 ? 's' : ''}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Occupancy</Text>
          <View style={styles.occRow}>
            <Text style={styles.occLabel}>Adults</Text>
            <Stepper inline onMinus={() => setAdults(guests.adults - 1)} onPlus={() => setAdults(guests.adults + 1)} value={guests.adults} />
          </View>
        </View>

        {quoteM.isPending ? (
          <StateView kind="loading" compact message="Re-checking availability & price…" />
        ) : quote?.unavailable ? (
          <View style={styles.unavail}>
            <TriangleAlert size={18} color={Colors.error} />
            <Text style={styles.unavailText}>Those dates aren't available on this rate. Try different dates.</Text>
          </View>
        ) : quote ? (
          <View style={styles.deltaCard}>
            <Row label="Previous total" value={formatNaira(quote.oldTotalKobo)} />
            <Row label="New total" value={formatNaira(quote.newTotalKobo)} />
            <View style={styles.divider} />
            <View style={styles.deltaRow}>
              <View style={styles.deltaLabelWrap}>
                <Wallet size={16} color={Colors.primary} />
                <Text style={styles.deltaLabel}>{charge ? 'Charged to wallet' : refund ? 'Refunded to wallet' : 'No change'}</Text>
              </View>
              <Text style={[styles.deltaVal, refund && { color: Colors.teal }]}>
                {charge ? '+' : refund ? '-' : ''}{formatNaira(Math.abs(delta))}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={applyM.isPending ? 'Applying…' : charge ? 'Pay delta & update' : refund ? 'Update & refund' : 'Update booking'}
          loading={applyM.isPending}
          disabled={!quote || quote.unavailable || quoteM.isPending}
          onPress={onApply}
        />
        {applyM.isError ? <Text style={styles.err}>{applyErrorMessage(applyM.error)}</Text> : null}
      </View>

      <Modal visible={!!picking} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.label}>Select dates</Text>
              <Pressable onPress={() => setPicking(null)} hitSlop={8} accessibilityLabel="Close date picker">
                <X size={20} color={Colors.onSurface} />
              </Pressable>
            </View>
            <View style={styles.modalSummary}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dateLabel}>Check-in</Text>
                <Text style={styles.dateVal}>{picking?.start ? formatShortDate(picking.start) : '—'}</Text>
              </View>
              <View style={styles.summaryDiv} />
              <View style={{ flex: 1 }}>
                <Text style={styles.dateLabel}>Check-out</Text>
                <Text style={styles.dateVal}>{picking?.end ? formatShortDate(picking.end) : '—'}</Text>
              </View>
            </View>
            {pickedNights > 0 ? (
              pickQuote?.unavailable ? (
                <Text style={[styles.pickNote, styles.pickNoteBad]}>Those nights aren't available on this rate. Pick other dates.</Text>
              ) : pickQuote ? (
                <Text style={styles.pickNote}>
                  New total {formatNaira(pickQuote.newTotalKobo)} ·{' '}
                  {pickQuote.deltaKobo > 0 ? `${formatNaira(pickQuote.deltaKobo)} more`
                    : pickQuote.deltaKobo < 0 ? `${formatNaira(-pickQuote.deltaKobo)} refunded` : 'no change'}
                </Text>
              ) : (
                <Text style={styles.pickNote}>Checking availability…</Text>
              )
            ) : null}
            <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <DateRangeCalendar
                start={picking?.start ?? null}
                end={picking?.end ?? null}
                onPick={(iso) => setPicking((p) => (p ? pickRange(p.start, p.end, iso) : p))}
              />
            </ScrollView>
            <View style={styles.modalFooter}>
              <PrimaryButton
                label={pickedNights > 0 ? `Apply · ${pickedNights} night${pickedNights > 1 ? 's' : ''}` : 'Select check-out date'}
                onPress={applyPicking}
                disabled={pickedNights <= 0 || !pickQuote || pickQuote.unavailable}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// The server's reason (e.g. "new dates unavailable") instead of a generic failure.
function applyErrorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string } } } | null)?.response?.data;
  return data?.error ?? "Couldn't apply changes. Please try again.";
}

function Stepper({ onMinus, onPlus, value, inline }: { onMinus: () => void; onPlus: () => void; value?: number; inline?: boolean }) {
  return (
    <View style={[styles.stepper, inline && styles.stepperInline]}>
      <Pressable style={styles.stepBtn} onPress={onMinus} hitSlop={6}><Minus size={16} color={Colors.onSurface} /></Pressable>
      {value != null ? <Text style={styles.stepVal}>{value}</Text> : null}
      <Pressable style={styles.stepBtn} onPress={onPlus} hitSlop={6}><Plus size={16} color={Colors.onSurface} /></Pressable>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow}><Text style={styles.kvLabel}>{label}</Text><Text style={styles.kvVal}>{value}</Text></View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  label: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dateBox: { flex: 1, gap: 4, alignItems: 'center' },
  dateLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  dateVal: { ...Typography.titleMd, color: Colors.onSurface },
  nights: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'center' },
  occRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  occLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md, marginTop: 4 },
  stepperInline: { marginTop: 0 },
  stepBtn: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  stepVal: { ...Typography.titleMd, color: Colors.onSurface, minWidth: 24, textAlign: 'center' },
  deltaCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between' },
  kvLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  kvVal: { ...Typography.bodySm, color: Colors.onSurface, fontWeight: '600' as const },
  divider: { height: 1, backgroundColor: Colors.outlineVariant },
  deltaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deltaLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deltaLabel: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  deltaVal: { ...Typography.titleLg, color: Colors.primary, fontWeight: '800' as const },
  unavail: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center' },
  unavailText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm, ...shadow2 },
  err: { ...Typography.caption, color: Colors.error, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,28,48,0.45)' },
  modalSheet: { backgroundColor: Colors.background, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, maxHeight: '85%', paddingTop: Spacing.md },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin },
  modalSummary: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  summaryDiv: { width: 1, height: 34, backgroundColor: Colors.outlineVariant, marginHorizontal: Spacing.md },
  modalScroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  modalFooter: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  pickNote: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  pickNoteBad: { color: Colors.error },
});
