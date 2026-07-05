import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Ticket, CalendarClock, XCircle, Car, MapPin, MessageSquare, Star,
  ReceiptText, ChevronRight, BadgeAlert,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { BookingStateBanner } from '@/features/stays/components';
import { useTrip } from '@/features/stays/trips';
import { formatStayRange, formatGuestSummary, formatNaira } from '@/features/stays/constants/stays.constants';

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id ?? '');

  if (trip.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Booking" />
        <StateView kind="loading" message="Loading your booking…" />
      </SafeAreaView>
    );
  }
  if (trip.isError || !trip.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Booking" />
        <StateView kind="error" icon="FileQuestion" title="Booking not found" message="We couldn't load this booking." actionLabel="My bookings" onAction={() => router.replace('/stays/trips')} />
      </SafeAreaView>
    );
  }

  const t = trip.data;
  const isUpcoming = t.bucket === 'upcoming' && t.state === 'CONFIRMED';
  const isCompleted = t.state === 'COMPLETED';
  const isCancelled = t.bucket === 'cancelled';
  const rideUrl = `/mobility?dropLat=${t.geo.lat}&dropLng=${t.geo.lng}&dropLabel=${encodeURIComponent(t.propertyName)}`;
  const mapUrl = `https://maps.google.com/?q=${t.geo.lat},${t.geo.lng}`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Booking detail" subtitle={t.reference} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: t.coverUrl }} style={styles.cover} />

        <BookingStateBanner state={t.state} />

        <View style={styles.card}>
          <Text style={styles.name}>{t.propertyName}</Text>
          <Row icon={<MapPin size={16} color={Colors.onSurfaceVariant} />} text={t.address} />
          <Row icon={<CalendarClock size={16} color={Colors.onSurfaceVariant} />} text={formatStayRange(t.checkIn, t.checkOut)} />
          <Text style={styles.line}>{t.roomTypeName} · {t.ratePlanName}</Text>
          <Text style={styles.line}>{formatGuestSummary(t.guests)}</Text>
          <Text style={styles.line}>Check-in {t.checkInTime} · Check-out {t.checkOutTime}</Text>
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t.paymentMethod === 'pay_at_property' ? 'Pay at property' : 'Total charged'}</Text>
            <Text style={styles.totalVal}>{formatNaira(t.totalKobo)}</Text>
          </View>
          {t.currency === 'USD' ? <Text style={styles.fx}>USD-priced rate settled in NGN.</Text> : null}
          <Text style={styles.policy}>{t.cancellationPolicy}</Text>
        </View>

        {/* Voucher + ride-to-hotel + directions */}
        <View style={styles.actionGrid}>
          <ActionTile icon={<Ticket size={20} color={Colors.primary} />} label="Voucher" onPress={() => router.push({ pathname: '/stays/booking/voucher', params: { id: t.id } })} />
          <ActionTile icon={<Car size={20} color={Colors.primary} />} label="Ride to hotel" onPress={() => router.push(rideUrl as never)} />
          <ActionTile icon={<MapPin size={20} color={Colors.primary} />} label="Directions" onPress={() => Linking.openURL(mapUrl)} />
        </View>

        {/* Trip management */}
        <View style={styles.menu}>
          {isUpcoming ? (
            <>
              <MenuRow icon={<CalendarClock size={18} color={Colors.onSurface} />} label="Modify booking" sub="Change dates or occupancy" onPress={() => router.push({ pathname: '/stays/trips/modify', params: { id: t.id } })} />
              <MenuRow icon={<XCircle size={18} color={Colors.error} />} label="Cancel booking" sub="See refund preview" danger onPress={() => router.push({ pathname: '/stays/trips/cancel', params: { id: t.id } })} />
            </>
          ) : null}
          {isCancelled ? (
            <MenuRow icon={<ReceiptText size={18} color={Colors.onSurface} />} label="Refund status" sub="Track your wallet refund" onPress={() => router.push({ pathname: '/stays/trips/refund-status', params: { id: t.id } })} />
          ) : null}
          {isCompleted ? (
            <MenuRow icon={<Star size={18} color={Colors.gold} />} label="Write a review" sub="Verified post-stay review" onPress={() => router.push({ pathname: '/stays/reviews/write', params: { id: t.id } })} />
          ) : null}
          <MenuRow icon={<MessageSquare size={18} color={Colors.onSurface} />} label="Chat with property" onPress={() => router.push({ pathname: '/stays/support/chat', params: { id: t.id } })} />
          <MenuRow icon={<BadgeAlert size={18} color={Colors.onSurface} />} label="Raise an issue / dispute" sub="Hotel has no record? Use the fast-path" onPress={() => router.push({ pathname: '/stays/support/dispute', params: { id: t.id } })} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.row}>{icon}<Text style={styles.rowText}>{text}</Text></View>
  );
}

function ActionTile({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.tile} onPress={onPress} accessibilityRole="button">
      <View style={styles.tileIcon}>{icon}</View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

function MenuRow({ icon, label, sub, onPress, danger }: { icon: React.ReactNode; label: string; sub?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={styles.menuRow} onPress={onPress} accessibilityRole="button">
      <View style={styles.menuIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuLabel, danger && { color: Colors.error }]}>{label}</Text>
        {sub ? <Text style={styles.menuSub}>{sub}</Text> : null}
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  cover: { width: '100%', height: 180, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainer },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 4 },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  line: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  totalVal: { ...Typography.titleLg, color: Colors.primary, fontWeight: '800' as const },
  fx: { ...Typography.caption, color: Colors.onSurfaceVariant },
  policy: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  actionGrid: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.md, alignItems: 'center', gap: 6 },
  tileIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const },
  menu: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  menuIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  menuSub: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 1 },
});
