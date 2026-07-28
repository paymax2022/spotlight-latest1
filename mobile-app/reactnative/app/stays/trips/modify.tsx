import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Minus, Plus, ArrowRight, Wallet, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useTrip, useModifyQuote, useApplyModify, type ModifyQuote } from '@/features/stays/trips';
import { formatNaira, formatShortDate, nightsBetween } from '@/features/stays/constants/stays.constants';
import type { GuestConfig } from '@/features/stays/types';

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

  if (trip.isLoading || !guests) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Modify booking" />
        <StateView kind="loading" message="Loading your booking…" />
      </SafeAreaView>
    );
  }
  if (trip.isError || !trip.data) {
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

  function setAdults(n: number) {
    setGuests((g) => (g ? { ...g, adults: Math.max(1, n) } : g));
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
            <View style={styles.dateBox}>
              <Text style={styles.dateLabel}>Check-in</Text>
              <Text style={styles.dateVal}>{formatShortDate(checkIn)}</Text>
              <Stepper onMinus={() => setCheckIn(shift(checkIn, -1))} onPlus={() => setCheckIn(shift(checkIn, 1))} />
            </View>
            <ArrowRight size={18} color={Colors.onSurfaceVariant} />
            <View style={styles.dateBox}>
              <Text style={styles.dateLabel}>Check-out</Text>
              <Text style={styles.dateVal}>{formatShortDate(checkOut)}</Text>
              <Stepper onMinus={() => setCheckOut(shift(checkOut, -1))} onPlus={() => setCheckOut(shift(checkOut, 1))} />
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
        {applyM.isError ? <Text style={styles.err}>Couldn't apply changes. Please try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
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
});
