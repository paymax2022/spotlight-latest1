import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import CommerceNotice from '@/features/events/components/CommerceNotice';
import { useTicket, useEvent, useMyRefunds, useRequestRefund } from '@/features/events/hooks';
import { idempotencyKey } from '@/features/events/api';
import { refundBlocker, REFUND_BLOCKER_COPY, isRefundPending, clampRefundReason } from '@/features/events/refund';
import { EventColors, formatNaira, EVENTS_COMMERCE_ENABLED } from '@/features/events/constants/events.constants';

const MIN_REASON = 5;

export default function RequestRefund() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const { data: t, isLoading, isError, refetch } = useTicket(ticketId ?? '');
  const { data: event } = useEvent(t?.event_id ?? '');
  const { data: refunds } = useMyRefunds();
  const request = useRequestRefund();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // One key per refund intent: a retry after a dropped connection replays the
  // same request server-side instead of opening a second refund.
  const idemKey = useRef<string | null>(null);

  if (!EVENTS_COMMERCE_ENABLED) {
    return <Shell><CommerceNotice /></Shell>;
  }
  if (isLoading) return <Shell><StateView kind="loading" message="Loading ticket…" /></Shell>;
  if (isError || !t) return <Shell><StateView kind="error" title="Couldn't load this ticket" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Shell>;

  const open = (refunds ?? []).find((r) => r.ticket_id === t.id && isRefundPending(r.status));
  const blocker = refundBlocker({
    state: t.state,
    price_paid_kobo: t.price_paid_kobo,
    eventState: event?.state,
    startsAt: event?.starts_at,
    cutoffHours: event?.refund_cutoff_hours,
  });

  const submit = async () => {
    setErr(null);
    const clean = clampRefundReason(reason);
    if (clean.length < MIN_REASON) { setErr('Tell the organiser briefly why you need a refund.'); return; }
    if (!idemKey.current) idemKey.current = idempotencyKey();
    try {
      await request.mutateAsync({ ticketId: t.id, reason: clean, idemKey: idemKey.current });
      idemKey.current = null;
      router.replace('/events/refunds');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send your request. Please try again.');
    }
  };

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.title} numberOfLines={2}>{event?.title ?? 'Event ticket'}</Text>
          {t.attendee_name ? <Text style={styles.sub}>Seat for {t.attendee_name}</Text> : null}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>You paid</Text>
            <Text style={styles.rowValue}>{formatNaira(t.price_paid_kobo)}</Text>
          </View>
          <Text style={styles.caption}>
            The organiser reviews every request. If approved, the exact amount returned to your wallet — and any
            fee withheld under the event's refund policy — is set by the server and shown under My refunds.
          </Text>
        </View>

        {event?.refund_policy ? (
          <View style={styles.disclosure}>
            <Text style={styles.disclosureTitle}>Refund policy</Text>
            <Text style={styles.disclosureText}>{event.refund_policy}</Text>
          </View>
        ) : null}

        {open ? (
          <StateView kind="empty" compact icon="Inbox" title="Request already open" message="You've already asked for a refund on this ticket. Track it under My refunds." actionLabel="My refunds" onAction={() => router.replace('/events/refunds')} />
        ) : blocker ? (
          <StateView kind="empty" compact icon="Ban" title="Refund not available" message={REFUND_BLOCKER_COPY[blocker]} actionLabel="Contact support" onAction={() => router.push({ pathname: '/events/support/new', params: { eventId: t.event_id, ticketId: t.id, kind: 'REFUND' } })} />
        ) : (
          <>
            <TextInputField
              label="Reason"
              placeholder="e.g. I can no longer attend on that date"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={500}
              error={err ?? undefined}
            />
            <PrimaryButton label="Request refund" onPress={submit} loading={request.isPending} disabled={!reason.trim()} />
          </>
        )}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request refund" backFallback="/events/my-tickets" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm, ...shadow1 },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: EventColors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...Typography.bodyMd, color: EventColors.muted },
  rowValue: { ...Typography.labelLg, color: Colors.onSurface },
  caption: { ...Typography.caption, color: EventColors.muted, lineHeight: 18 },
  disclosure: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.xs },
  disclosureTitle: { ...Typography.titleMd, color: Colors.onSurface },
  disclosureText: { ...Typography.bodySm, color: EventColors.muted, lineHeight: 20 },
});
