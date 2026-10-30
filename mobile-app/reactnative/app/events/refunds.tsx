import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LifeBuoy } from 'lucide-react-native';
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
import { useMyRefunds } from '@/features/events/hooks';
import { isRefundPending } from '@/features/events/refund';
import {
  EventColors, formatNaira, REFUND_STATE_BADGE, EVENTS_COMMERCE_ENABLED,
} from '@/features/events/constants/events.constants';
import type { Refund } from '@/features/events/types';

function when(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MyRefunds() {
  const { data, isLoading, isError, refetch, isRefetching } = useMyRefunds();

  if (!EVENTS_COMMERCE_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="My refunds" backFallback="/events/orders" />
        <CommerceNotice />
        <EventsTabBar />
      </SafeAreaView>
    );
  }

  const refunds = Array.isArray(data) ? data : [];
  const pending = refunds.filter((r) => isRefundPending(r.status));
  const settled = refunds.filter((r) => !isRefundPending(r.status));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My refunds" backFallback="/events/orders" />
      {isLoading ? (
        <StateView kind="loading" message="Loading your refunds…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load your refunds" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : refunds.length === 0 ? (
        <StateView kind="empty" title="No refund requests" message="Ask for a refund from a ticket's pass screen. Each request and its outcome shows here." icon="Inbox" actionLabel="My tickets" onAction={() => router.push('/events/my-tickets')} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
        >
          {pending.length > 0 ? <Text style={styles.section}>In progress</Text> : null}
          {pending.map((r) => <RefundRow key={r.id} r={r} />)}
          {settled.length > 0 ? <Text style={styles.section}>History</Text> : null}
          {settled.map((r) => <RefundRow key={r.id} r={r} />)}
          <Pressable style={styles.supportCta} onPress={() => router.push('/events/support')} accessibilityRole="link">
            <LifeBuoy size={16} color={EventColors.brand} strokeWidth={2} />
            <Text style={styles.supportCtaText}>Question about a refund? Contact support</Text>
          </Pressable>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
      <EventsTabBar />
    </SafeAreaView>
  );
}

// Every amount on this row is the server's: refund_kobo is what returns to the
// wallet and fee_kobo what was withheld. The screen never derives one from the other.
function RefundRow({ r }: { r: Refund }) {
  const pill = pillFor(REFUND_STATE_BADGE, r.status);
  return (
    <View style={styles.row} accessible accessibilityLabel={`Refund for ${r.event_title ?? 'ticket'}, ${pill?.label ?? r.status}`}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{r.event_title ?? 'Event ticket'}</Text>
          <Text style={styles.sub}>{r.tier_name ? `${r.tier_name} · ` : ''}Requested {when(r.created_at)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={styles.amount}>{formatNaira(r.refund_kobo)}</Text>
          {pill ? <StatusPill {...pill} /> : null}
        </View>
      </View>
      <View style={styles.breakdown}>
        <Text style={styles.meta}>Paid {formatNaira(r.amount_kobo)}</Text>
        {r.fee_kobo > 0 ? <Text style={styles.meta}>Fee withheld {formatNaira(r.fee_kobo)}</Text> : null}
      </View>
      {r.reason ? <Text style={styles.reason} numberOfLines={3}>“{r.reason}”</Text> : null}
      {r.decision_note ? <Text style={styles.note}>Organiser: {r.decision_note}</Text> : null}
      {r.status === 'FAILED' && r.failure_reason ? <Text style={styles.failed}>{r.failure_reason}</Text> : null}
      {r.decided_at ? <Text style={styles.meta}>Decided {when(r.decided_at)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  row: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.xs, ...shadow1 },
  rowTop: { flexDirection: 'row', gap: Spacing.md },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: EventColors.muted, marginTop: 2 },
  amount: { ...Typography.labelLg, color: Colors.onSurface },
  breakdown: { flexDirection: 'row', gap: Spacing.md },
  meta: { ...Typography.caption, color: EventColors.muted },
  reason: { ...Typography.bodySm, color: Colors.onSurface },
  note: { ...Typography.bodySm, color: EventColors.muted },
  failed: { ...Typography.bodySm, color: EventColors.danger },
  supportCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant },
  supportCtaText: { ...Typography.labelMd, color: EventColors.brand },
});
