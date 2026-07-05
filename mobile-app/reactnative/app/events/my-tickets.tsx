import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { Calendar, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import StateView from '@/components/StateView';
import { useMyTickets } from '@/features/events/hooks';
import { getEvent } from '@/features/events/api';
import { EventColors, TICKET_STATE_BADGE, eventCoverEmoji, eventBannerColor } from '@/features/events/constants/events.constants';

const FILTERS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
] as const;

function dt(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function MyTickets() {
  const { data, isLoading, isError, refetch } = useMyTickets();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  // The backend Ticket carries only ids (event_id, tier_id) — fetch each
  // distinct event once to show title/venue/date/tier context in the list.
  const eventIds = useMemo(() => Array.from(new Set((data ?? []).map((t) => t.event_id))), [data]);
  const eventQueries = useQueries({
    queries: eventIds.map((id) => ({ queryKey: ['events', 'event', id], queryFn: () => getEvent(id) })),
  });
  const eventsById = useMemo(() => {
    const map = new Map<string, (typeof eventQueries)[number]['data']>();
    eventQueries.forEach((q, i) => { if (q.data) map.set(eventIds[i], q.data); });
    return map;
  }, [eventQueries, eventIds]);

  const tickets = useMemo(() => {
    const now = Date.now();
    return (data ?? []).filter((t) => {
      const ev = eventsById.get(t.event_id);
      const starts = ev ? new Date(ev.starts_at).getTime() : 0;
      return tab === 'upcoming' ? starts >= now && t.state !== 'USED' : starts < now || t.state === 'USED';
    });
  }, [data, tab, eventsById]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My tickets" />
      <View style={{ marginBottom: Spacing.md }}>
        <SegmentedControl options={FILTERS as any} value={tab} onChange={setTab} />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading your tickets…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load tickets" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : tickets.length === 0 ? (
        <StateView kind="empty" title="No tickets here" message={tab === 'upcoming' ? 'Buy a ticket to see your pass here.' : 'No past tickets yet.'} icon="Ticket" actionLabel="Browse events" onAction={() => router.push('/events')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {tickets.map((t) => {
            const ev = eventsById.get(t.event_id);
            const tier = ev?.tiers.find((x) => x.id === t.tier_id);
            const bannerColor = ev ? eventBannerColor(ev.id, ev.category) : EventColors.brand;
            const coverEmoji = ev ? eventCoverEmoji(ev.category) : '🎟️';
            const stateLabel = TICKET_STATE_BADGE[t.state]?.label ?? t.state;
            return (
              <Pressable key={t.id} onPress={() => router.push(`/events/ticket/${t.id}`)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}>
                <View style={[styles.thumb, { backgroundColor: bannerColor }]}>
                  <Text style={styles.thumbEmoji}>{coverEmoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>{ev?.title ?? 'Event'}</Text>
                  <Text style={styles.tier}>{tier?.name ?? 'Ticket'} · {stateLabel}</Text>
                  <View style={styles.metaRow}>
                    <Calendar size={13} color={EventColors.muted} strokeWidth={1.8} />
                    <Text style={styles.meta}>{ev ? dt(ev.starts_at) : ''}</Text>
                  </View>
                </View>
                <ChevronRight size={18} color={EventColors.muted} />
              </Pressable>
            );
          })}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  thumb: { width: 56, height: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 26 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  tier: { ...Typography.labelSm, color: EventColors.muted, marginVertical: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { ...Typography.caption, color: EventColors.muted },
});
