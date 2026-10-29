import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LifeBuoy, Inbox } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import StatusPill, { pillFor } from '@/features/events/components/StatusPill';
import CommerceNotice from '@/features/events/components/CommerceNotice';
import { useBooking } from '@/features/events/hooks';
import {
  EventColors, formatNaira, EVENTS_COMMERCE_ENABLED,
  BOOKING_STATE_BADGE, ORDER_STATE_BADGE,
} from '@/features/events/constants/events.constants';
import type { Order } from '@/features/events/types';

function when(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function EventReceipt() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const { data: b, isLoading, isError, refetch } = useBooking(ref ?? '');

  if (!EVENTS_COMMERCE_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Receipt" backFallback="/events/orders" />
        <CommerceNotice />
      </SafeAreaView>
    );
  }

  if (isLoading) return <Shell><StateView kind="loading" message="Loading receipt…" /></Shell>;
  if (isError || !b) return <Shell><StateView kind="error" title="Receipt not found" message="This booking may belong to another account, or commerce wasn't switched on when it was bought." actionLabel="Retry" onAction={() => refetch()} /></Shell>;

  const seats = b.orders ?? [];
  const outstanding = b.total_kobo - b.refunded_kobo;
  const badge = pillFor(BOOKING_STATE_BADGE, b.status);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Receipt" subtitle={b.booking_ref} backFallback="/events/orders" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.eventHead}>
            <Text style={styles.title} numberOfLines={2}>{b.event_title}</Text>
            {badge ? <StatusPill {...badge} /> : null}
          </View>
          <Text style={styles.sub}>{b.venue}{b.city ? ` · ${b.city}` : ''}</Text>
          <Text style={styles.sub}>{when(b.starts_at)}</Text>
          <Text style={styles.sub}>Bought {when(b.created_at)}</Text>
        </View>

        <View style={styles.card}>
          <Row label={`${b.seats} seat${b.seats === 1 ? '' : 's'} × ${formatNaira(seats[0]?.unit_price_kobo ?? 0)}`} value={formatNaira(b.subtotal_kobo)} />
          {b.discount_kobo > 0 ? (
            <Row label={`Promo ${b.promo_code ?? ''}`} value={`− ${formatNaira(b.discount_kobo)}`} tone="ok" />
          ) : null}
          <View style={styles.divider} />
          <Row label="Paid" value={formatNaira(b.total_kobo)} bold />
          {b.refunded_kobo > 0 ? (
            <>
              <Row label="Refunded" value={`− ${formatNaira(b.refunded_kobo)}`} tone="muted" />
              <View style={styles.divider} />
              <Row label="Still with you" value={formatNaira(outstanding)} bold />
            </>
          ) : null}
          <Text style={styles.split}>
            Of the {formatNaira(b.total_kobo)} paid, {formatNaira(b.platform_fee_kobo)} is the platform service fee
            ({(b.fee_bps / 100).toFixed(2).replace(/\.?0+$/, '')}%), taken from the organiser's share — the organiser
            receives {formatNaira(b.organiser_net_kobo)}. You were not charged anything on top of the total.
          </Text>
        </View>

        <Text style={styles.section}>Seats</Text>
        {seats.length === 0 ? (
          <Text style={styles.sub}>The seat list for this booking is still being reconciled. Your pass is under My tickets.</Text>
        ) : seats.map((o) => <SeatRow key={o.id} o={o} />)}

        {b.refund_policy ? (
          <View style={styles.disclosure}>
            <Text style={styles.disclosureTitle}>Refund policy</Text>
            <Text style={styles.disclosureText}>{b.refund_policy}</Text>
            <Text style={styles.disclosureText}>Refunds are requested per ticket from that ticket's pass screen.</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton label="My tickets" variant="secondary" onPress={() => router.push('/events/my-tickets')} fullWidth />
        </View>
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <Pressable style={styles.footerBtn} onPress={() => router.push('/events/refunds')} accessibilityRole="link" accessibilityLabel="My refunds">
            <Inbox size={16} color={EventColors.brand} strokeWidth={2} />
            <Text style={styles.footerText}>Refunds</Text>
          </Pressable>
          <Pressable
            style={styles.footerBtn}
            onPress={() => router.push({ pathname: '/events/support/new', params: { eventId: b.event_id, kind: 'PAYMENT' } })}
            accessibilityRole="link"
            accessibilityLabel="Ask support about this order"
          >
            <LifeBuoy size={16} color={EventColors.brand} strokeWidth={2} />
            <Text style={styles.footerText}>Get help</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function SeatRow({ o }: { o: Order }) {
  const pill = pillFor(ORDER_STATE_BADGE, o.status);
  return (
    <View style={styles.seat}>
      <View style={{ flex: 1 }}>
        <Text style={styles.seatName}>{o.attendee_name || 'Unnamed seat'}</Text>
        <Text style={styles.seatSub}>{o.tier_name ?? 'Ticket'}{o.payment_rail ? ` · paid by ${o.payment_rail}` : ''}</Text>
        {o.refunded_kobo > 0 ? <Text style={styles.seatRefunded}>− {formatNaira(o.refunded_kobo)} refunded</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={styles.seatAmount}>{formatNaira(o.total_kobo)}</Text>
        {pill ? <StatusPill {...pill} /> : null}
      </View>
    </View>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: 'ok' | 'muted' }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.bold]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.bold, tone === 'ok' && styles.rowOk, tone === 'muted' && styles.rowMuted]}>{value}</Text>
    </View>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Receipt" backFallback="/events/orders" />{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  eventHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  sub: { ...Typography.bodySm, color: EventColors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  rowLabel: { ...Typography.bodyMd, color: EventColors.muted, flex: 1 },
  rowValue: { ...Typography.bodyMd, color: Colors.onSurface, textAlign: 'right' },
  rowOk: { color: EventColors.ok },
  rowMuted: { color: EventColors.muted },
  bold: { ...Typography.labelLg, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: 2 },
  split: { ...Typography.caption, color: EventColors.muted, lineHeight: 18 },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  seat: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  seatName: { ...Typography.labelMd, color: Colors.onSurface },
  seatSub: { ...Typography.caption, color: EventColors.muted, marginTop: 2 },
  seatRefunded: { ...Typography.caption, color: EventColors.muted, marginTop: 2 },
  seatAmount: { ...Typography.labelMd, color: Colors.onSurface },
  disclosure: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.xs },
  disclosureTitle: { ...Typography.titleMd, color: Colors.onSurface },
  disclosureText: { ...Typography.bodySm, color: EventColors.muted, lineHeight: 20 },
  actions: { gap: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  footerRow: { flexDirection: 'row', gap: Spacing.md },
  footerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow },
  footerText: { ...Typography.labelMd, color: EventColors.brand },
});
