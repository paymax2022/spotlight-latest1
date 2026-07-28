import React, { useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Calendar, MapPin, Users, Check, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import { useEvents } from '@/features/connect/networking/hooks';
import type { NetworkEvent, RsvpState } from '@/features/connect/networking/types';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const RSVP_LABEL: Record<RsvpState, string> = {
  going: 'Going',
  interested: 'Interested',
  none: '',
};

/** Events directory (PRD §10.3 NW-08). */
export default function EventsScreen() {
  const [query, setQuery] = useState('');
  const eventsQuery = useEvents(query);
  const events = eventsQuery.data ?? [];

  function renderBody() {
    if (eventsQuery.isLoading) {
      return <StateView kind="loading" message="Loading events…" />;
    }
    if (eventsQuery.isError) {
      return (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load events"
          message="Something went wrong."
          actionLabel="Retry"
          onAction={() => eventsQuery.refetch()}
        />
      );
    }
    if (events.length === 0) {
      return (
        <StateView
          kind="empty"
          icon="Calendar"
          title="No events found"
          message="Try a different search, or host your own."
        />
      );
    }
    return (
      <View style={styles.list}>
        {events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Events"
        rightSlot={
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Create event"
            onPress={() => router.push('/connect/networking/create-event')}
          >
            <Plus size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <SearchBar placeholder="Search events…" value={query} onChangeText={setQuery} />
        {renderBody()}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function EventCard({ event }: { event: NetworkEvent }) {
  const rsvpLabel = RSVP_LABEL[event.rsvp];
  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      onPress={() => router.push(`/connect/networking/event-detail?id=${encodeURIComponent(event.id)}`)}
    >
      {event.coverUrl ? (
        <Image source={{ uri: event.coverUrl }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <Calendar size={26} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.date}>{formatDate(event.startsAt)}</Text>

        <View style={styles.row}>
          <MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.rowText} numberOfLines={1}>
            {event.isOnline ? 'Online' : `${event.venue}, ${event.city}`}
          </Text>
        </View>

        <View style={styles.footer}>
          <View style={styles.attendees}>
            <Users size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.rowText}>{event.attendeeCount} going</Text>
          </View>
          <Text style={styles.price}>
            {event.priceKobo === 0 ? 'Free' : formatKobo(event.priceKobo)}
          </Text>
        </View>

        {rsvpLabel ? (
          <View style={styles.rsvpBadge}>
            {event.rsvp === 'going' ? (
              <Check size={13} color={ConnectColors.ok} strokeWidth={2.4} />
            ) : (
              <Sparkles size={13} color={ConnectColors.brand} strokeWidth={2.2} />
            )}
            <Text
              style={[
                styles.rsvpText,
                { color: event.rsvp === 'going' ? ConnectColors.ok : ConnectColors.brand },
              ]}
            >
              {rsvpLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: 130, backgroundColor: Colors.surfaceContainerHigh },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: Spacing.cardPadding, gap: Spacing.xs },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  date: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  rowText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  attendees: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  rsvpBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    marginTop: Spacing.xs,
  },
  rsvpText: { ...Typography.caption, fontWeight: '700' },
});
