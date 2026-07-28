import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CircleCheckBig } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { BookingStateBanner } from '@/features/stays/components';
import { useStaysStore } from '@/features/stays/store';
import { useBook } from '@/features/stays/hooks';
import {
  newIdempotencyKey, formatNaira, formatStayRange, StaysColors,
} from '@/features/stays/constants/stays.constants';
import type { Reservation } from '@/features/stays/types';

type Phase = 'booking' | 'confirmed';

const STEPS = ['Re-checking availability', 'Holding your funds', 'Confirming with the hotel', 'Issuing your voucher'];

export default function ProcessingScreen() {
  const { draft, leadGuest, occupants, paymentMethod, prebook, resetBooking } = useStaysStore();
  const bookM = useBook();
  const [phase, setPhase] = useState<Phase>('booking');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [step, setStep] = useState(0);
  const started = useRef(false);

  // Animate the step indicator while booking.
  useEffect(() => {
    if (phase !== 'booking') return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 350);
    return () => clearInterval(t);
  }, [phase]);

  // Run the book (step 2 of prebook → book). On failure, the hold auto-releases.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!draft || !prebook || !leadGuest) {
      router.replace('/stays/book/failure');
      return;
    }
    bookM.mutate(
      {
        bookToken: prebook.bookToken,
        leadGuest,
        occupants,
        paymentMethod,
        idempotencyKey: newIdempotencyKey(),
        consentNdpa: true,
      },
      {
        onSuccess: (res) => {
          if (res.ok && res.reservation) {
            setReservation(res.reservation);
            setPhase('confirmed');
          } else {
            router.replace({ pathname: '/stays/book/failure', params: { code: res.errorCode ?? 'BOOK_REJECTED_BY_SUPPLIER' } });
          }
        },
        onError: () => router.replace({ pathname: '/stays/book/failure', params: { code: 'SUPPLIER_TIMEOUT' } }),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'booking') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.title}>Confirming your booking…</Text>
          <Text style={styles.subtitle}>Money is held — not charged — until the hotel confirms.</Text>
          <View style={styles.steps}>
            {STEPS.map((s, i) => (
              <View key={s} style={styles.stepRow}>
                <View style={[styles.stepDot, i <= step && styles.stepDotOn]} />
                <Text style={[styles.stepText, i <= step && styles.stepTextOn]}>{s}</Text>
              </View>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Confirmed (inline success; full voucher/trips screens are owned by SM2).
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.successIcon}><CircleCheckBig size={56} color={StaysColors.ok} strokeWidth={2} /></View>
        <Text style={styles.successTitle}>Booking confirmed!</Text>
        <Text style={styles.ref}>Reference {reservation?.reference}</Text>

        {reservation ? <BookingStateBanner state={reservation.state} /> : null}

        {reservation ? (
          <View style={styles.card}>
            <Text style={styles.propName}>{reservation.propertyName}</Text>
            <Text style={styles.line}>{reservation.city}</Text>
            <Text style={styles.line}>{formatStayRange(reservation.checkIn, reservation.checkOut)}</Text>
            <Text style={styles.line}>{reservation.roomTypeName} · {reservation.ratePlanName}</Text>
            <View style={styles.divider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{reservation.paymentMethod === 'pay_at_property' ? 'Pay at property' : 'Charged'}</Text>
              <Text style={styles.totalVal}>{formatNaira(reservation.totalKobo)}</Text>
            </View>
            {reservation.currency === 'USD' ? <Text style={styles.fx}>USD-priced rate settled in NGN.</Text> : null}
          </View>
        ) : null}

        <Text style={styles.note}>Your voucher and trip details are in My bookings. We've notified the property.</Text>

        <View style={styles.actions}>
          <PrimaryButton label="View my booking" onPress={() => { resetBooking(); router.replace('/stays/trips'); }} />
          <PrimaryButton label="Back to stays" variant="secondary" onPress={() => { resetBooking(); router.replace('/stays'); }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  title: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.md },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  steps: { marginTop: Spacing.lg, gap: Spacing.sm, alignSelf: 'stretch', paddingHorizontal: Spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.surfaceContainerHigh },
  stepDotOn: { backgroundColor: Colors.primary },
  stepText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  stepTextOn: { color: Colors.onSurface, fontWeight: '600' as const },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md, alignItems: 'stretch' },
  successIcon: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  ref: { ...Typography.labelLg, color: Colors.primary, textAlign: 'center', marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  propName: { ...Typography.titleLg, color: Colors.onSurface },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  totalVal: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  fx: { ...Typography.caption, color: Colors.onSurfaceVariant },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
});
