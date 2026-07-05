import React from 'react';
import { View, Text, Image, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Calendar, MapPin, Users, Building2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { formatKobo } from '@/features/connect/constants/format';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import { useEvent, useRsvpEvent } from '@/features/connect/networking/hooks';
import type { RsvpState } from '@/features/connect/networking/types';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const RSVP_OPTIONS: { value: RsvpState; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'interested', label: 'Interested' },
  { value: 'none', label: 'Not going' },
];

/** Event detail with RSVP control (PRD §10.3 NW-09). */
export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = String(id ?? '');
  const eventQuery = useEvent(eventId);
  const rsvp = useRsvpEvent();

  const event = eventQuery.data;
  const currentRsvp: RsvpState = event?.rsvp ?? 'none';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Event" />
      {eventQuery.isLoading ? (
        <StateView kind="loading" message="Loading event…" />
      ) : eventQuery.isError ? (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load event"
          message="Something went wrong."
          actionLabel="Retry"
          onAction={() => eventQuery.refetch()}
        />
      ) : !event ? (
        <StateView kind="empty" icon="Calendar" title="Event not found" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {event.coverUrl ? (
            <Image source={{ uri: event.coverUrl }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverFallback]}>
              <Calendar size={30} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            </View>
          )}

          <View style={styles.block}>
            <Text style={styles.title}>{event.title}</Text>

            <InfoRow icon={<Calendar size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} text={formatDate(event.startsAt)} />
            <InfoRow
              icon={<MapPin size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />}
              text={event.isOnline ? 'Online' : `${event.venue}, ${event.city}`}
            />
            <InfoRow icon={<Building2 size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} text={`Hosted by ${event.hostName}`} />
            <InfoRow
              icon={<Users size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />}
              text={
                event.capacity
                  ? `${event.attendeeCount} / ${event.capacity} going`
                  : `${event.attendeeCount} going`
              }
            />

            <Text style={styles.price}>
              {event.priceKobo === 0 ? 'Free' : formatKobo(event.priceKobo)}
            </Text>

            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.desc}>{event.description}</Text>

            {event.tags.length ? (
              <View style={styles.tags}>
                <DiscoveryChipRow items={event.tags} variant="static" />
              </View>
            ) : null}
          </View>

          <View style={styles.rsvpBlock}>
            <Text style={[styles.sectionTitle, styles.rsvpTitle]}>Your RSVP</Text>
            <SegmentedControl
              options={RSVP_OPTIONS}
              value={currentRsvp}
              onChange={(state) => rsvp.mutate({ id: event.id, state })}
            />
          </View>

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function InfoRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.infoRow}>
      {icon}
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.lg },
  cover: { width: '100%', height: 180, backgroundColor: Colors.surfaceContainerHigh },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, gap: Spacing.sm },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  infoText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  price: { ...Typography.titleMd, color: ConnectColors.brand, marginTop: Spacing.xs },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700', marginTop: Spacing.md },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  tags: { marginTop: Spacing.sm },
  rsvpBlock: { paddingTop: Spacing.lg, gap: Spacing.sm },
  rsvpTitle: { paddingHorizontal: Spacing.containerMargin, marginTop: 0 },
});
