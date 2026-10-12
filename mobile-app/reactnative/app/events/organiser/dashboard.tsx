import React, { useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Users, ScanLine, ChevronRight, Pencil, Copy, Pause, Play, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import {
  useOrganiserEvents, useDuplicateEvent, usePauseEvent, useResumeEvent, useCancelEvent,
} from '@/features/events/hooks';
import { idempotencyKey, lifecycleErrorMessage } from '@/features/events/api';
import type { OrganiserEventStats } from '@/features/events/types';
import { useEventsRealtime } from '@/features/events/realtime/useEventsRealtime';
import { EventColors, formatNaira, formatNairaCompact, EVENT_STATE_BADGE, EVENTS_EDIT_LIFECYCLE_ENABLED } from '@/features/events/constants/events.constants';

export default function OrganiserDashboard() {
  // Live check-in push (accelerates the poll below when accepted scans come
  // in) — see useEventsRealtime's header comment. Safe no-op when the
  // EXPO_PUBLIC_REALTIME_ENABLED flag is off.
  useEventsRealtime();
  const { data, isLoading, isError, refetch } = useOrganiserEvents();

  const totalGross = (data ?? []).reduce((s, e) => s + e.gross_kobo, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Organiser"
        rightSlot={
          <Pressable onPress={() => router.push('/events/organiser/create')} hitSlop={10} accessibilityLabel="Create event">
            <Plus size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading dashboard…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load dashboard" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No events yet" message="Create your first event to start selling tickets." icon="Ticket" actionLabel="Create event" onAction={() => router.push('/events/organiser/create')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Gross sales</Text>
              <Text style={styles.summaryValue}>{formatNairaCompact(totalGross)}</Text>
            </View>
          </View>

          <Pressable style={styles.stewardCta} onPress={() => router.push('/events/steward/scan')}>
            <ScanLine size={20} color={Colors.primary} />
            <Text style={styles.stewardText}>Open steward scanner</Text>
            <ChevronRight size={18} color={EventColors.muted} />
          </Pressable>

          {data!.map((stats) => {
            const e = stats.event;
            const pct = stats.tickets_total ? Math.round((stats.tickets_sold / stats.tickets_total) * 100) : 0;
            const meta = EVENT_STATE_BADGE[e.state] ?? EVENT_STATE_BADGE.APPROVED;
            return (
              <View key={e.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{e.title}</Text>
                  <Text style={[styles.status, { color: meta.color }]}>{meta.label}</Text>
                </View>
                <View style={styles.statsRow}>
                  <Stat label="Sold" value={`${stats.tickets_sold}${stats.tickets_total ? `/${stats.tickets_total}` : ''}`} />
                  <Stat label="Gross" value={formatNaira(stats.gross_kobo)} />
                </View>
                {stats.tickets_total ? (
                  <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
                ) : null}
                {EVENTS_EDIT_LIFECYCLE_ENABLED ? <EventActions stats={stats} /> : null}
                <Pressable style={styles.attendeesLink} onPress={() => router.push({ pathname: '/events/organiser/attendees', params: { eventId: e.id } })}>
                  <Users size={16} color={EventColors.brand} />
                  <Text style={styles.attendeesText}>View attendees</Text>
                  <ChevronRight size={16} color={EventColors.muted} />
                </Pressable>
              </View>
            );
          })}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// Cancel refunds buyers at 90% (10% platform fee is kept) — see ADR for the cancel policy.
const CANCEL_REFUND_PCT = 90;

function EventActions({ stats }: { stats: OrganiserEventStats }) {
  const e = stats.event;
  const duplicate = useDuplicateEvent(e.id);
  const pause = usePauseEvent(e.id);
  const resume = useResumeEvent(e.id);
  const cancel = useCancelEvent(e.id);
  // One key per cancel intent: a retry after a network failure replays instead
  // of double-refunding. Cleared once the cancel succeeds.
  const cancelKey = useRef<string | null>(null);

  const busy = duplicate.isPending || pause.isPending || resume.isPending || cancel.isPending;
  const state = String(e.state);
  const ended = state === 'CLOSED' || state === 'CANCELLED';

  const fail = (title: string) => (err: unknown) => Alert.alert(title, lifecycleErrorMessage(err));

  const onEdit = () => router.push({ pathname: '/events/organiser/create', params: { id: e.id } });
  const onDuplicate = () =>
    duplicate.mutate(undefined, {
      onSuccess: (created) => router.push({ pathname: '/events/organiser/create', params: { id: created.id } }),
      onError: fail('Couldn\'t duplicate event'),
    });
  const onPause = () => pause.mutate(undefined, { onError: fail('Couldn\'t pause sales') });
  const onResume = () => resume.mutate(undefined, { onError: fail('Couldn\'t resume sales') });
  const onCancel = () => {
    cancelKey.current = cancelKey.current ?? idempotencyKey();
    const refund = formatNaira(Math.floor((stats.gross_kobo * CANCEL_REFUND_PCT) / 100));
    const impact = stats.tickets_sold > 0
      ? `${stats.tickets_sold} ticket${stats.tickets_sold === 1 ? '' : 's'} · ${refund} refunded at ${CANCEL_REFUND_PCT}%`
      : 'No tickets have been sold, so nothing will be refunded.';
    Alert.alert(
      `Cancel "${e.title}"?`,
      `${impact}\n\nThe remaining ${100 - CANCEL_REFUND_PCT}% is kept as a platform fee. This can't be undone.`,
      [
        { text: 'Keep event', style: 'cancel' },
        {
          text: 'Cancel event', style: 'destructive',
          onPress: () => cancel.mutate(
            { reason: 'Cancelled by organiser', idemKey: cancelKey.current as string },
            { onSuccess: () => { cancelKey.current = null; }, onError: (err) => {
                // A definite server answer (HTTP status) ends this intent; only a network failure keeps the key for replay.
                if ((err as { response?: { status?: number } })?.response?.status) cancelKey.current = null;
                fail('Couldn\'t cancel event')(err);
              } },
          ),
        },
      ],
    );
  };

  return (
    <View style={styles.actionsRow}>
      {!ended ? <ActionBtn icon={Pencil} label="Edit" onPress={onEdit} disabled={busy} /> : null}
      <ActionBtn icon={Copy} label="Duplicate" onPress={onDuplicate} disabled={busy} />
      {state === 'LIVE' ? <ActionBtn icon={Pause} label="Pause" onPress={onPause} disabled={busy} /> : null}
      {state === 'PAUSED' ? <ActionBtn icon={Play} label="Resume" onPress={onResume} disabled={busy} /> : null}
      {!ended ? <ActionBtn icon={XCircle} label="Cancel" onPress={onCancel} disabled={busy} danger /> : null}
    </View>
  );
}

function ActionBtn({ icon: Icon, label, onPress, disabled, danger }: {
  icon: React.ComponentType<{ size?: number; color?: string }>; label: string; onPress: () => void; disabled?: boolean; danger?: boolean;
}) {
  const color = danger ? EventColors.danger : EventColors.brand;
  return (
    <Pressable style={[styles.actionBtn, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={16} color={color} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  summary: { flexDirection: 'row', backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center' },
  summaryItem: { flex: 1, gap: 4 },
  summaryLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  summaryValue: { ...Typography.headlineMd, color: Colors.onPrimary },
  summaryDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: Spacing.md },
  stewardCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  stewardText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md, ...shadow1 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  status: { ...Typography.labelSm, fontWeight: '700' as const },
  statsRow: { flexDirection: 'row', gap: Spacing.lg },
  stat: { gap: 2 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: EventColors.muted },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: EventColors.ok },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  actionText: { ...Typography.labelMd },
  attendeesLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  attendeesText: { ...Typography.labelMd, color: EventColors.brand, flex: 1 },
});
