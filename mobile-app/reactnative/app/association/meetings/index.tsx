import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Video, MapPin, Users, ChevronRight, CheckCircle2, Plus, Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { useMeetings, usePendingMeetings, useDecideMeeting } from '@/features/association/hooks/useEngagement';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { confirmAsync } from '@/lib/confirm';
import { formatDateTime } from '@/features/association/utils/associationFormatters';
import { MEETING_SEGMENTS, MEETING_MODE_LABEL } from '@/features/association/constants/engagement.constants';
import type { MeetingSummary, RsvpStatus, PendingMeeting } from '@/features/association/types/engagement.types';

const RSVP_LABEL: Record<Exclude<RsvpStatus, null>, string> = { YES: 'Going', NO: 'Not going', MAYBE: 'Maybe' };

export default function MeetingsDashboard() {
  const meetings = useMeetings();
  const [tab, setTab] = useState<string>('upcoming');
  const access = useAdminAccess();
  // Org id comes from the admin DTO — the client never guesses one.
  const orgId = access.data?.isAdmin ? access.data.organisationId ?? undefined : undefined;
  const pending = usePendingMeetings(orgId);
  const decide = useDecideMeeting();

  const list = useMemo(() => {
    const all = meetings.data ?? [];
    return tab === 'past'
      ? all.filter((m) => m.state === 'PAST' || m.state === 'CANCELLED')
      : all.filter((m) => m.state === 'UPCOMING' || m.state === 'LIVE');
  }, [meetings.data, tab]);

  const queue = pending.data ?? [];

  const onDecide = async (item: PendingMeeting, approve: boolean) => {
    const ok = await confirmAsync({
      title: approve ? 'Approve this meeting?' : 'Reject this meeting?',
      message: approve
        ? `"${item.title}" will go on the calendar and members will be notified.`
        : `"${item.title}" will not be added. ${item.proposedByName} proposed it.`,
      confirmLabel: approve ? 'Approve' : 'Reject',
      destructive: !approve,
    });
    if (ok) decide.mutate({ id: item.id, approve });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Meetings" />
      <View style={styles.segWrap}>
        <SegmentedControl options={MEETING_SEGMENTS as never} value={tab} onChange={setTab} />
      </View>

      {/* Admin approval queue. Only rendered for an admin, and only when there
          is something waiting — an empty box on every other member's screen
          would be noise about a job that is not theirs. */}
      {orgId && queue.length > 0 ? (
        <View style={styles.queue}>
          <Text style={styles.queueTitle}>Awaiting your approval ({queue.length})</Text>
          {queue.map((item) => (
            <View key={item.id} style={styles.queueRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.queueName} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.queueMeta} numberOfLines={1}>
                  {formatDateTime(item.startsAt)} · proposed by {item.proposedByName}
                </Text>
              </View>
              <Pressable
                onPress={() => onDecide(item, true)}
                disabled={decide.isPending}
                hitSlop={8}
                style={styles.queueBtn}
                accessibilityRole="button"
                accessibilityLabel={`Approve ${item.title}`}
              >
                <Check size={18} color={Colors.tertiaryContainer} strokeWidth={2.4} />
              </Pressable>
              <Pressable
                onPress={() => onDecide(item, false)}
                disabled={decide.isPending}
                hitSlop={8}
                style={styles.queueBtn}
                accessibilityRole="button"
                accessibilityLabel={`Reject ${item.title}`}
              >
                <X size={18} color={Colors.error} strokeWidth={2.4} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {meetings.isLoading ? (
        <StateView kind="loading" message="Loading meetings…" />
      ) : meetings.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => meetings.refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="CalendarDays" title={tab === 'past' ? 'No past meetings' : 'No upcoming meetings'} message="Meetings will appear here when scheduled." />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(m) => m.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => <MeetingCard meeting={item} />}
        />
      )}

      <Pressable
        style={styles.fab}
        onPress={() => router.push('/association/meetings/propose')}
        accessibilityRole="button"
        accessibilityLabel="Propose a meeting"
      >
        <Plus size={22} color={Colors.onPrimary} strokeWidth={2.6} />
      </Pressable>
    </SafeAreaView>
  );
}

function MeetingCard({ meeting: m }: { meeting: MeetingSummary }) {
  const Mode = m.mode === 'PHYSICAL' ? MapPin : Video;
  return (
    <Pressable
      onPress={() => router.push(`/association/meetings/${m.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${m.title}, ${formatDateTime(m.startsAt)}`}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <View style={styles.modePill}>
          <Mode size={12} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.modeText}>{MEETING_MODE_LABEL[m.mode]}</Text>
        </View>
        {m.state === 'CANCELLED' ? <Text style={styles.cancelled}>Cancelled</Text> : null}
        {m.rsvp ? (
          <View style={styles.rsvpChip}>
            <CheckCircle2 size={11} color={Colors.teal} strokeWidth={2.4} />
            <Text style={styles.rsvpText}>{RSVP_LABEL[m.rsvp]}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={2}>{m.title}</Text>
      {/* Only a proposer ever sees a non-approved meeting in their own list —
          the server hides everyone else's. Saying which it is stops a member
          assuming their proposal is already on the organisation's calendar. */}
      {m.approvalStatus === 'PENDING' || m.approvalStatus === 'REJECTED' ? (
        <View style={styles.pendingPill}>
          <Text style={styles.pendingText}>
            {m.approvalStatus === 'PENDING' ? 'Awaiting approval — only you can see this' : 'Not approved'}
          </Text>
        </View>
      ) : null}
      <Text style={styles.when}>{formatDateTime(m.startsAt)}</Text>
      <View style={styles.metaRow}>
        {m.location ? (
          <View style={styles.metaItem}>
            <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.meta} numberOfLines={1}>{m.location}</Text>
          </View>
        ) : null}
        <View style={styles.metaItem}>
          <Users size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.meta}>{m.attendeeCount}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  queue: {
    marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm,
  },
  queueTitle: { ...Typography.labelLg, color: Colors.onSurface },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  queueName: { ...Typography.labelMd, color: Colors.onSurface },
  queueMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  queueBtn: {
    width: 34, height: 34, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  fab: {
    position: 'absolute', right: Spacing.containerMargin, bottom: Spacing.xl,
    width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  pendingPill: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh,
  },
  pendingText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  segWrap: { paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 4 },
  pressed: { opacity: 0.9 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  modePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  modeText: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const },
  cancelled: { ...Typography.caption, color: Colors.error, fontWeight: '700' as const },
  rsvpChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  rsvpText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' as const },
  title: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  when: { ...Typography.labelMd, color: Colors.secondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flexShrink: 1 },
});
