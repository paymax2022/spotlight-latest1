import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ScanLine, Search, X } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SegmentedControl from '@/components/SegmentedControl';
import CommerceNotice from '@/features/events/components/CommerceNotice';
import StatusPill from '@/features/events/components/StatusPill';
import GatePicker from '@/features/events/components/GatePicker';
import { useEvent, useRoster, useCheckinStats, useCheckinHistory, useManualCheckIn, useUndoCheckIn } from '@/features/events/hooks';
import { lifecycleErrorMessage } from '@/features/events/api';
import { rememberedGateName, rememberGateName } from '@/features/events/gates';
import { EventColors, EVENTS_COMMERCE_ENABLED } from '@/features/events/constants/events.constants';
import type { RosterRow, RosterFilter } from '@/features/events/types';

const BACK = '/events/organiser/dashboard';
type Tab = 'roster' | 'history';
type StateFilter = '' | 'waiting' | 'checked_in';
const TABS: { value: Tab; label: string }[] = [{ value: 'roster', label: 'Roster' }, { value: 'history', label: 'History' }];
const FILTERS: { value: StateFilter; label: string }[] = [
  { value: '', label: 'All' }, { value: 'waiting', label: 'Waiting' }, { value: 'checked_in', label: 'Checked in' },
];

function time(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function DoorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const eventId = typeof id === 'string' ? id : '';
  const { data: event } = useEvent(eventId);
  const [tab, setTab] = useState<Tab>('roster');
  const [state, setState] = useState<StateFilter>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [action, setAction] = useState<{ kind: 'in' | 'undo'; row: RosterRow } | null>(null);

  // Search is server-side; wait for a typing pause rather than a request per key.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filter: RosterFilter = { state, q: q || undefined };
  const roster = useRoster(eventId, filter);
  const stats = useCheckinStats(eventId);
  const history = useCheckinHistory(eventId);

  if (!EVENTS_COMMERCE_ENABLED) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Door" backFallback={BACK} /><CommerceNotice /></SafeAreaView>;
  }

  const refreshing = roster.isRefetching || stats.isRefetching || history.isRefetching;
  const refresh = () => { roster.refetch(); stats.refetch(); history.refetch(); };
  const s = stats.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Door"
        subtitle={event?.title}
        backFallback={BACK}
        rightSlot={
          <Pressable onPress={() => router.push({ pathname: '/events/steward/scan', params: { eventId } })} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Open scanner">
            <ScanLine size={20} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {s ? (
          <View style={styles.card}>
            <View style={styles.statsHead}>
              <Text style={styles.big}>{s.checked_in}<Text style={styles.muted}> / {s.total} in</Text></Text>
              <StatusPill {...(s.open
                ? { label: 'Door open', color: EventColors.ok, bg: EventColors.okBg }
                : { label: 'Door closed', color: EventColors.muted, bg: EventColors.surfaceAlt })} />
            </View>
            <Text style={styles.muted}>{s.waiting} waiting · {s.refunded} refunded</Text>
            {Object.keys(s.by_gate ?? {}).length > 0 ? (
              <Text style={styles.muted}>{Object.entries(s.by_gate).map(([g, n]) => `${g}: ${n}`).join(' · ')}</Text>
            ) : null}
            {s.window_opens_at || s.window_closes_at ? (
              <Text style={styles.caption}>Check-in window {time(s.window_opens_at)} – {time(s.window_closes_at)}</Text>
            ) : null}
          </View>
        ) : stats.isError ? (
          <Text style={styles.caption}>Couldn't load door counters. Pull to retry.</Text>
        ) : null}

        <SegmentedControl options={TABS} value={tab} onChange={setTab} />

        {tab === 'roster' ? (
          <>
            <TextInputField placeholder="Search name, @cashtag or ticket" value={search} onChangeText={setSearch} autoCapitalize="none" leftIcon={<Search size={18} color={EventColors.muted} />} />
            <SegmentedControl options={FILTERS} value={state} onChange={setState} />
            {roster.isLoading ? (
              <StateView kind="loading" compact message="Loading roster…" />
            ) : roster.isError ? (
              <StateView kind="error" compact title="Couldn't load roster" message={lifecycleErrorMessage(roster.error)} actionLabel="Retry" onAction={() => roster.refetch()} />
            ) : (roster.data ?? []).length === 0 ? (
              <StateView kind="empty" compact icon="Users" title="No one here" message={q ? 'No ticket matches that search.' : 'No tickets in this view yet.'} />
            ) : (roster.data ?? []).map((r) => (
              <RosterItem key={r.ticket_id} r={r} onCheckIn={() => setAction({ kind: 'in', row: r })} onUndo={() => setAction({ kind: 'undo', row: r })} />
            ))}
          </>
        ) : history.isLoading ? (
          <StateView kind="loading" compact message="Loading history…" />
        ) : history.isError ? (
          <StateView kind="error" compact title="Couldn't load history" message={lifecycleErrorMessage(history.error)} actionLabel="Retry" onAction={() => history.refetch()} />
        ) : (history.data ?? []).length === 0 ? (
          <StateView kind="empty" compact icon="History" title="No check-ins yet" message="Every scan, manual entry and reversal is logged here." />
        ) : (history.data ?? []).map((h) => {
          const undo = h.action === 'UNDO' || h.action === 'OUT';
          return (
            <View key={h.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{undo ? 'Check-in reversed' : 'Checked in'} · {h.method.toLowerCase()}</Text>
                <Text style={styles.muted}>{h.actor_name ?? 'Staff'}{h.gate ? ` · ${h.gate}` : ''} · {time(h.occurred_at)}</Text>
                {h.reason ? <Text style={styles.caption}>“{h.reason}”</Text> : null}
              </View>
              <Text style={styles.ticketRef} numberOfLines={1}>{h.ticket_id.slice(0, 8)}</Text>
            </View>
          );
        })}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>

      {action ? <DoorActionSheet eventId={eventId} kind={action.kind} row={action.row} onClose={() => setAction(null)} /> : null}
    </SafeAreaView>
  );
}

function RosterItem({ r, onCheckIn, onUndo }: { r: RosterRow; onCheckIn: () => void; onUndo: () => void }) {
  const holder = r.attendee_name || r.name;
  const admissible = !r.checked_in && (r.state === 'ISSUED' || r.state === 'TRANSFERRED');
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{holder}</Text>
        <Text style={styles.muted} numberOfLines={1}>{r.cashtag ? `${r.cashtag} · ` : ''}{r.tier_name}</Text>
        {r.checked_in ? (
          <Text style={styles.okText}>In {time(r.checked_in_at)}{r.gate ? ` · ${r.gate}` : ''}{r.checked_in_by_name ? ` · by ${r.checked_in_by_name}` : ''}</Text>
        ) : r.state === 'REFUNDED' ? <Text style={styles.caption}>Refunded — not admissible</Text> : null}
      </View>
      {r.checked_in ? (
        <Pressable onPress={onUndo} style={styles.smallBtn} accessibilityRole="button" accessibilityLabel={`Undo check-in for ${holder}`}>
          <Text style={styles.undoText}>Undo</Text>
        </Pressable>
      ) : admissible ? (
        <Pressable onPress={onCheckIn} style={[styles.smallBtn, styles.inBtn]} accessibilityRole="button" accessibilityLabel={`Check in ${holder}`}>
          <Text style={styles.inText}>Check in</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Both overrides are audited server-side and both require a reason
// (checkin_service.go ManualCheckIn / UndoCheckIn), so the sheet is the confirm
// step: nothing is sent until the reason is filled and the action re-stated.
function DoorActionSheet({ eventId, kind, row, onClose }: { eventId: string; kind: 'in' | 'undo'; row: RosterRow; onClose: () => void }) {
  const checkIn = useManualCheckIn(eventId);
  const undo = useUndoCheckIn(eventId);
  const [gate, setGate] = useState(rememberedGateName(eventId));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const holder = row.attendee_name || row.name;
  const busy = checkIn.isPending || undo.isPending;

  const confirm = async () => {
    setErr(null);
    const why = reason.trim();
    if (!why) { setErr('A reason is required — it is kept in the door log.'); return; }
    try {
      if (kind === 'in') {
        rememberGateName(eventId, gate);
        await checkIn.mutateAsync({ ticket_id: row.ticket_id, gate, reason: why });
      } else {
        await undo.mutateAsync({ ticket_id: row.ticket_id, reason: why });
      }
      onClose();
    } catch (e) {
      setErr(lifecycleErrorMessage(e));
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{kind === 'in' ? 'Manual check-in' : 'Undo check-in'}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><X size={22} color={EventColors.muted} /></Pressable>
          </View>
          <Text style={styles.muted}>
            {kind === 'in'
              ? `Admit ${holder} (${row.tier_name}) without a scan.`
              : `Reverse ${holder}'s check-in. Their pass is reissued and must be scanned again to enter.`}
          </Text>
          {kind === 'in' ? <GatePicker value={gate} onChange={setGate} /> : null}
          <TextInputField label="Reason" placeholder={kind === 'in' ? 'e.g. Phone battery dead, ID checked' : 'e.g. Scanned the wrong guest'} value={reason} onChangeText={setReason} maxLength={500} error={err ?? undefined} />
          <PrimaryButton label={kind === 'in' ? `Confirm check-in` : 'Confirm undo'} variant={kind === 'in' ? 'primary' : 'danger'} onPress={confirm} loading={busy} disabled={!reason.trim()} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  iconBtn: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.xs },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.xs, ...shadow1 },
  statsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  big: { ...Typography.headlineMd, color: Colors.onSurface },
  muted: { ...Typography.bodySm, color: EventColors.muted },
  caption: { ...Typography.caption, color: EventColors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  name: { ...Typography.labelMd, color: Colors.onSurface },
  okText: { ...Typography.caption, color: EventColors.ok, marginTop: 2 },
  ticketRef: { ...Typography.caption, color: EventColors.muted, maxWidth: 80 },
  smallBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  inBtn: { backgroundColor: EventColors.brand },
  inText: { ...Typography.labelMd, color: Colors.onPrimary },
  undoText: { ...Typography.labelMd, color: EventColors.danger },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
});
