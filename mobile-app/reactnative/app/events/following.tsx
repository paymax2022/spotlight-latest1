import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Calendar, MapPin, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import EventsTabBar, { EVENTS_SOCIAL } from '@/features/events/components/EventsTabBar';
import { useFollowingEvents } from '@/features/events/hooks';
import { EventColors, eventCoverEmoji, eventBannerColor } from '@/features/events/constants/events.constants';

function dt(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function FollowingScreen() {
  // The hook runs even with the flag off (hooks cannot be conditional); the
  // flag-off screen never shows its result.
  const { data, isLoading, isError, refetch } = useFollowingEvents();

  if (!EVENTS_SOCIAL) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Following" backFallback="/events" />
        <StateView kind="empty" title="Not available" message="This feature isn't available yet." />
      </SafeAreaView>
    );
  }

  const events = data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Following" backFallback="/events" />

      {isLoading ? (
        <StateView kind="loading" message="Loading events…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load events" message="Please check your connection and try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : events.length === 0 ? (
        <StateView kind="empty" title="Nothing here yet" message="Follow an organiser to see their events here" icon="Users" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {events.map((e) => (
            <Pressable key={e.id} onPress={() => router.push(`/events/${e.id}`)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}>
              <View style={[styles.thumb, { backgroundColor: eventBannerColor(e.id, e.category) }]}>
                <Text style={styles.thumbEmoji}>{eventCoverEmoji(e.category)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{e.title}</Text>
                <View style={styles.metaRow}>
                  <Calendar size={13} color={EventColors.muted} strokeWidth={1.8} />
                  <Text style={styles.meta} numberOfLines={1}>{dt(e.starts_at)}</Text>
                </View>
                <View style={styles.metaRow}>
                  <MapPin size={13} color={EventColors.muted} strokeWidth={1.8} />
                  <Text style={styles.meta} numberOfLines={1}>{e.venue}</Text>
                </View>
              </View>
              <ChevronRight size={18} color={EventColors.muted} />
            </Pressable>
          ))}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
      <EventsTabBar />
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  meta: { ...Typography.caption, color: EventColors.muted, flex: 1 },
});

