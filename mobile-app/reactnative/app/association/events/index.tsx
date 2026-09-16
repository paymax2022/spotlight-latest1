import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, CheckCircle2, Ticket, Plus, Share2, Mail } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { useEvents } from '@/features/association/hooks/useCommunity';
import { useAdminAccess } from '@/features/association/hooks/useAdminMembers';
import { shareEvent } from '@/features/association/utils/eventShare';
import { formatDateTime, formatNaira } from '@/features/association/utils/associationFormatters';
import type { EventSummary } from '@/features/association/types/community.types';

const SEGMENTS = [
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'PAST', label: 'Past' },
] as const;

export default function EventsList() {
  const events = useEvents();
  const [tab, setTab] = useState<string>('UPCOMING');
  const list = useMemo(() => (events.data ?? []).filter((e) => e.state === tab), [events.data, tab]);
  const access = useAdminAccess();
  const isAdmin = Boolean(access.data?.isAdmin);
  const [note, setNote] = useState<string | null>(null);

  const onShare = async (e: EventSummary) => {
    const outcome = await shareEvent(e);
    // Desktop web has no navigator.share, so this falls back to the clipboard —
    // and a copy nobody is told about reads as a button that did nothing.
    setNote(outcome === 'copied' ? 'Event details copied to your clipboard.' : outcome === 'failed' ? "Couldn't share the event." : null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Events" />
      <View style={styles.segWrap}>
        <SegmentedControl options={SEGMENTS as never} value={tab} onChange={setTab} />
      </View>
      {events.isLoading ? (
        <StateView kind="loading" message="Loading events…" />
      ) : events.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => events.refetch()} />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Ticket" title={tab === 'PAST' ? 'No past events' : 'No upcoming events'} message="Events will appear here when scheduled." />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(e) => e.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => <EventCard event={item} isAdmin={isAdmin} onShare={onShare} />}
        />
      )}
      {note ? <Text style={styles.note}>{note}</Text> : null}

      {isAdmin ? (
        <Pressable
          style={styles.fab}
          onPress={() => router.push('/association/events/new')}
          accessibilityRole="button"
          accessibilityLabel="New event"
        >
          <Plus size={22} color={Colors.onPrimary} strokeWidth={2.6} />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

function EventCard({ event: e, isAdmin, onShare }: { event: EventSummary; isAdmin: boolean; onShare: (e: EventSummary) => void }) {
  return (
    <Pressable
      onPress={() => router.push(`/association/events/${e.id}`)}
      accessibilityRole="button"
      accessibilityLabel={e.title}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      {e.coverUrl ? <Image source={{ uri: e.coverUrl }} style={styles.cover} /> : <View style={[styles.cover, styles.coverFallback]} />}
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.when}>{formatDateTime(e.startsAt)}</Text>
        <View style={styles.metaRow}>
          <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.meta} numberOfLines={1}>{e.location}</Text>
        </View>
        <View style={styles.tagRow}>
          <View style={[styles.tag, { backgroundColor: e.paid ? Colors.iconBgGold : Colors.iconBgTeal }]}>
            <Text style={[styles.tagText, { color: e.paid ? Colors.gold : Colors.teal }]}>{e.paid ? formatNaira(e.feeKobo) : 'Free'}</Text>
          </View>
          {e.registered ? (
            <View style={styles.registered}>
              <CheckCircle2 size={12} color={Colors.teal} strokeWidth={2.4} />
              <Text style={styles.registeredText}>Registered</Text>
            </View>
          ) : null}
          {/* Being invited and having responded are independent: the invitation
              and the RSVP share one row, so a member can be invited and not yet
              registered, or registered without ever being invited. */}
          {e.invited && !e.registered ? (
            <View style={styles.registered}>
              <Mail size={12} color={Colors.primary} strokeWidth={2.4} />
              <Text style={[styles.registeredText, { color: Colors.primary }]}>Invited</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={() => onShare(e)}
            hitSlop={8}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel={`Share ${e.title}`}
          >
            <Share2 size={15} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.actionText}>Share</Text>
          </Pressable>
          {isAdmin ? (
            <Pressable
              onPress={() => router.push(`/association/events/invite/${e.id}`)}
              hitSlop={8}
              style={styles.action}
              accessibilityRole="button"
              accessibilityLabel={`Invite members to ${e.title}`}
            >
              <Mail size={15} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.actionText}>Invite</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', paddingBottom: Spacing.sm },
  actionRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { ...Typography.labelSm, color: Colors.secondary },
  fab: {
    position: 'absolute', right: Spacing.containerMargin, bottom: Spacing.xl,
    width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  segWrap: { paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden' },
  pressed: { opacity: 0.9 },
  cover: { width: '100%', height: 120 },
  coverFallback: { backgroundColor: Colors.surfaceContainerHigh },
  cardBody: { padding: Spacing.md, gap: 4 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  when: { ...Typography.labelMd, color: Colors.secondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4 },
  tag: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  tagText: { ...Typography.caption, fontWeight: '700' as const },
  registered: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  registeredText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' as const },
});
