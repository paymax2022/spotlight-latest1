import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, Clock, Users, Ticket, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import QrCodeView from '@/components/QrCodeView';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useBookings, useCancelBooking } from '@/features/mobility/hooks/useEvent';
import { EVENT_ENABLED, EVENT_OFFER_TYPES, BOOKING_STATUS_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNaira } from '@/features/mobility/utils/mobilityFormatters';
import type { EventBooking, BookingStatus, EventOfferType } from '@/features/mobility/types/event.types';

const dt = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const typeLabel = (t: EventOfferType) => EVENT_OFFER_TYPES.find((x) => x.value === t)?.label ?? t;

function statusTone(s: BookingStatus) {
  if (s === 'completed' || s === 'boarded') return 'success' as const;
  if (s === 'cancelled' || s === 'refunded') return 'danger' as const;
  if (s === 'confirmed') return 'info' as const;
  return 'neutral' as const;
}

export default function BookingsScreen() {
  const bookings = useBookings();
  const cancel = useCancelBooking();

  if (!EVENT_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="My bookings" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My bookings" />
      {bookings.isLoading ? (
        <StateView kind="loading" message="Loading bookings…" />
      ) : bookings.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => bookings.refetch()} />
      ) : (bookings.data ?? []).length === 0 ? (
        <MobilityEdgeState
          kind="empty"
          title="No bookings yet"
          message="Book event transport to get a QR boarding pass."
          actionLabel="Browse transport"
          onAction={() => router.replace('/mobility/events')}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={bookings.isRefetching} onRefresh={() => bookings.refetch()} tintColor={Colors.primary} />}
        >
          {bookings.data!.map((b) => (
            <BookingCard key={b.id} b={b} onCancel={() => cancel.mutate(b.id)} cancelling={cancel.isPending} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function BookingCard({ b, onCancel, cancelling }: { b: EventBooking; onCancel: () => void; cancelling: boolean }) {
  const active = b.status !== 'cancelled' && b.status !== 'refunded';
  const canCancel = b.status === 'booked' || b.status === 'confirmed';
  return (
    <View style={[styles.pass, shadow1]}>
      <View style={styles.passHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventTitle} numberOfLines={1}>{b.eventTitle}</Text>
          <Text style={styles.type}>{typeLabel(b.type)}</Text>
        </View>
        <StatusBadge label={BOOKING_STATUS_LABEL[b.status]} tone={statusTone(b.status)} />
      </View>

      <View style={styles.metaRow}><MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText} numberOfLines={1}>{b.venue}</Text></View>
      <View style={styles.metaRow}><Clock size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>{dt(b.departureTime)}</Text></View>
      <View style={styles.metaRow}><Users size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>{b.seats} seat{b.seats === 1 ? '' : 's'} · {formatNaira(b.totalKobo)}</Text></View>
      {b.ticketRef ? <View style={styles.metaRow}><Ticket size={14} color={Colors.secondary} strokeWidth={2} /><Text style={[styles.metaText, { color: Colors.secondary }]}>Bundle · {b.ticketRef}</Text></View> : null}
      {b.pickupZone ? <View style={styles.metaRow}><MapPin size={14} color={Colors.tertiaryContainer} strokeWidth={2} /><Text style={styles.metaText} numberOfLines={1}>Boarding: {b.pickupZone}</Text></View> : null}

      <View style={styles.dashed} />

      {active && b.qrCode ? (
        <View style={styles.qrWrap}>
          <QrCodeView payload={b.qrCode} size={160} />
          <Text style={styles.qrHint}>Show this QR to the organizer to board.</Text>
        </View>
      ) : (
        <Text style={styles.voided}>{b.status === 'refunded' ? 'Refunded — QR voided' : b.status === 'completed' ? 'Trip completed' : 'QR unavailable'}</Text>
      )}

      {canCancel && (
        <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={cancelling}>
          <X size={16} color={Colors.error} strokeWidth={2} />
          <Text style={styles.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel & request refund'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  pass: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm },
  passHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  eventTitle: { ...Typography.titleMd, color: Colors.onSurface },
  type: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  dashed: { height: 1, borderTopWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', marginVertical: Spacing.xs },
  qrWrap: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  qrHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  voided: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.md },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 48, marginTop: Spacing.xs },
  cancelText: { ...Typography.labelMd, color: Colors.error },
});
