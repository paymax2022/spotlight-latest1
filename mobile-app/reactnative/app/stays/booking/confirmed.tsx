import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheckBig, Ticket, Car, CalendarPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { BookingStateBanner } from '@/features/stays/components';
import { useTrip } from '@/features/stays/trips';
import { formatStayRange, formatGuestSummary, formatNaira } from '@/features/stays/constants/stays.constants';

/**
 * Booking confirmed (PRD §17 E, screen 34). Target of SM1's book/processing
 * success path. Shows the confirmed reservation, voucher CTA, add-to-calendar
 * and the ride-to-hotel cross-sell into /mobility.
 */
export default function BookingConfirmedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id ?? '');

  if (trip.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView kind="loading" message="Loading your confirmation…" />
      </SafeAreaView>
    );
  }
  if (trip.isError || !trip.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Booking confirmed" showBack={false} />
        <StateView kind="empty" icon="BedDouble" title="Confirmation unavailable" message="Find this booking in My bookings." actionLabel="My bookings" onAction={() => router.replace('/stays/trips')} />
      </SafeAreaView>
    );
  }

  const t = trip.data;
  const rideUrl = `/mobility?dropLat=${t.geo.lat}&dropLng=${t.geo.lng}&dropLabel=${encodeURIComponent(t.propertyName)}`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.icon}><CircleCheckBig size={56} color={Colors.teal} strokeWidth={2} /></View>
        <Text style={styles.title}>Booking confirmed!</Text>
        <Text style={styles.ref}>Reference {t.reference}</Text>

        <BookingStateBanner state={t.state} />

        <View style={styles.card}>
          <Text style={styles.name}>{t.propertyName}</Text>
          <Text style={styles.line}>{t.city}</Text>
          <Text style={styles.line}>{formatStayRange(t.checkIn, t.checkOut)}</Text>
          <Text style={styles.line}>{t.roomTypeName} · {t.ratePlanName}</Text>
          <Text style={styles.line}>{formatGuestSummary(t.guests)}</Text>
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t.paymentMethod === 'pay_at_property' ? 'Pay at property' : 'Charged'}</Text>
            <Text style={styles.totalVal}>{formatNaira(t.totalKobo)}</Text>
          </View>
          {t.currency === 'USD' ? <Text style={styles.fx}>USD-priced rate settled in NGN.</Text> : null}
        </View>

        <View style={styles.quickRow}>
          <QuickBtn icon={<Ticket size={18} color={Colors.primary} />} label="Voucher" onPress={() => router.push({ pathname: '/stays/booking/voucher', params: { id: t.id } })} />
          <QuickBtn icon={<CalendarPlus size={18} color={Colors.primary} />} label="Add to calendar" onPress={() => router.push({ pathname: '/stays/booking/voucher', params: { id: t.id } })} />
        </View>

        {/* Ride-to-hotel cross-sell (PRD §17 E, screen 36 → /mobility) */}
        <PrimaryButton label="Book a ride to the hotel" onPress={() => router.push(rideUrl as never)} />

        <Text style={styles.note}>Your voucher and trip details are in My bookings. We've notified the property.</Text>

        <View style={styles.actions}>
          <PrimaryButton label="View my booking" variant="secondary" onPress={() => router.replace({ pathname: '/stays/trips/[id]', params: { id: t.id } })} />
          <PrimaryButton label="Back to stays" variant="ghost" onPress={() => router.replace('/stays')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickBtn({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <PrimaryButton label={label} variant="secondary" onPress={onPress} style={styles.quickBtn} />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  icon: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  ref: { ...Typography.labelLg, color: Colors.primary, textAlign: 'center', marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  totalVal: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  fx: { ...Typography.caption, color: Colors.onSurfaceVariant },
  quickRow: { flexDirection: 'row', gap: Spacing.sm },
  quickBtn: { flex: 1 },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
});
