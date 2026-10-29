import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bell, Inbox, LifeBuoy, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import EventsTabBar from '@/features/events/components/EventsTabBar';
import StatusPill, { pillFor } from '@/features/events/components/StatusPill';
import CommerceNotice from '@/features/events/components/CommerceNotice';
import { useMyBookings, useUnreadCount } from '@/features/events/hooks';
import {
  EventColors, formatNaira, BOOKING_STATE_BADGE, EVENTS_COMMERCE_ENABLED,
} from '@/features/events/constants/events.constants';
import type { Booking } from '@/features/events/types';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function EventOrders() {
  const { data, isLoading, isError, refetch } = useMyBookings();
  const unread = useUnreadCount();

  if (!EVENTS_COMMERCE_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="My orders" backFallback="/events" />
        <CommerceNotice />
        <EventsTabBar />
      </SafeAreaView>
    );
  }

  const bookings = Array.isArray(data) ? data : [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="My orders"
        backFallback="/events"
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/events/refunds')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="My refunds">
              <Inbox size={20} color={Colors.onSurface} strokeWidth={2} />
            </Pressable>
            <Pressable onPress={() => router.push('/events/notifications')} hitSlop={10} style={styles.iconBtn} accessibilityLabel={unread > 0 ? `Event inbox, ${unread} unread` : 'Event inbox'}>
              <Bell size={20} color={Colors.onSurface} strokeWidth={2} />
              {unread > 0 ? <View style={styles.dot} /> : null}
            </Pressable>
          </View>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading your receipts…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load your orders" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : bookings.length === 0 ? (
        <StateView kind="empty" title="No orders yet" message="Tickets you buy appear here with a receipt for each checkout." icon="ReceiptText" actionLabel="Browse events" onAction={() => router.replace('/events')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {bookings.map((b) => <BookingRow key={b.booking_ref} b={b} />)}
          <Pressable style={styles.supportCta} onPress={() => router.push('/events/support')} accessibilityRole="link">
            <LifeBuoy size={16} color={EventColors.brand} strokeWidth={2} />
            <Text style={styles.supportCtaText}>Something wrong with an order? Open a support case</Text>
          </Pressable>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
      <EventsTabBar />
    </SafeAreaView>
  );
}

function BookingRow({ b }: { b: Booking }) {
  const pill = pillFor(BOOKING_STATE_BADGE, b.status);
  const refunded = b.refunded_kobo > 0;
  return (
    <Pressable
      onPress={() => router.push(`/events/orders/${encodeURIComponent(b.booking_ref)}`)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      accessibilityLabel={`Receipt for ${b.event_title}, ${b.seats} seat${b.seats === 1 ? '' : 's'}`}
    >
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{b.event_title}</Text>
          <Text style={styles.sub}>{b.seats} seat{b.seats === 1 ? '' : 's'} · {when(b.created_at)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={styles.amount}>{formatNaira(b.total_kobo)}</Text>
          {pill ? <StatusPill {...pill} /> : null}
        </View>
      </View>
      <View style={styles.rowBottom}>
        <Text style={styles.ref}>{b.booking_ref}</Text>
        {refunded ? <Text style={styles.refunded}>− {formatNaira(b.refunded_kobo)} refunded</Text> : null}
        <ChevronRight size={16} color={EventColors.muted} style={{ marginLeft: 'auto' }} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  dot: { position: 'absolute', top: 6, right: 7, width: 8, height: 8, borderRadius: 4, backgroundColor: EventColors.danger },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  row: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  rowTop: { flexDirection: 'row', gap: Spacing.md },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: EventColors.muted, marginTop: 2 },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ref: { ...Typography.caption, color: EventColors.muted },
  refunded: { ...Typography.caption, color: EventColors.ok },
  supportCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant },
  supportCtaText: { ...Typography.labelMd, color: EventColors.brand },
});
