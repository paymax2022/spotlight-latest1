import React from 'react';
import { View, Text, ScrollView, StyleSheet, Image, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useOrganiser, useFollowOrganiser } from '@/features/events/hooks';
import { EventColors, eventBannerColor, eventCoverEmoji } from '@/features/events/constants/events.constants';

// events-social flag: exactly the string 'true' turns it on; default off.
const EVENTS_SOCIAL = process.env.EXPO_PUBLIC_EVENTS_SOCIAL === 'true';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Public organiser page: banner, name, bio, follower count, a follow button and
// the organiser's upcoming events. The flag check sits in this wrapper so the
// data hooks below only run when the feature is on.
export default function OrganiserProfileScreen() {
  if (!EVENTS_SOCIAL) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Organiser" />
        <StateView kind="empty" title="Not available" message="This page isn't available right now." />
      </SafeAreaView>
    );
  }
  return <OrganiserProfile />;
}

function OrganiserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const organiserId = id ?? '';
  const { data: org, isLoading, isError, refetch } = useOrganiser(organiserId);
  const follow = useFollowOrganiser(organiserId);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Organiser" />
        <StateView kind="loading" message="Loading organiser…" />
      </SafeAreaView>
    );
  }
  if (isError || !org) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Organiser" />
        <StateView kind="error" title="Couldn't load organiser" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      </SafeAreaView>
    );
  }

  const name = org.display_name?.trim() || 'Organiser';
  const bannerUrl = org.banner_url?.trim() ?? '';
  const busy = isLoading || follow.isPending;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={name} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.banner}>
          {bannerUrl ? (
            <Image source={{ uri: bannerUrl }} style={styles.bannerImage} resizeMode="cover" accessibilityLabel={`${name} banner`} />
          ) : null}
        </View>

        <Text style={styles.name}>{name}</Text>
        {org.bio ? <Text style={styles.bio}>{org.bio}</Text> : null}

        <View style={styles.followRow}>
          <Text style={styles.followers}>
            {follow.state.count} {follow.state.count === 1 ? 'follower' : 'followers'}
          </Text>
          <Pressable
            onPress={follow.toggle}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={follow.state.liked ? 'Unfollow this organiser' : 'Follow this organiser'}
            accessibilityState={{ disabled: busy, selected: follow.state.liked }}
            style={[styles.followBtn, follow.state.liked && styles.followBtnOn, busy && styles.followBtnDisabled]}
          >
            <Text style={[styles.followText, follow.state.liked && styles.followTextOn]}>
              {follow.state.liked ? 'Following' : 'Follow'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Upcoming events</Text>
        {org.events.length === 0 ? (
          <Text style={styles.empty}>No upcoming events.</Text>
        ) : (
          org.events.map((ev) => (
            <Pressable
              key={ev.id}
              style={styles.eventRow}
              onPress={() => router.push({ pathname: '/events/[id]', params: { id: ev.id } })}
              accessibilityRole="link"
              accessibilityLabel={ev.title}
            >
              <View style={[styles.eventThumb, { backgroundColor: eventBannerColor(ev.id, ev.category) }]}>
                <Text style={styles.eventEmoji}>{eventCoverEmoji(ev.category)}</Text>
              </View>
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={1}>{ev.title}</Text>
                <Text style={styles.eventMeta} numberOfLines={1}>{when(ev.starts_at)}</Text>
                <Text style={styles.eventMeta} numberOfLines={1}>{ev.venue}</Text>
              </View>
              <ChevronRight size={18} color={EventColors.muted} />
            </Pressable>
          ))
        )}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  banner: { height: 140, borderRadius: Radius.xl, backgroundColor: EventColors.brand, overflow: 'hidden', marginBottom: Spacing.sm },
  bannerImage: { width: '100%', height: '100%' },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  bio: { ...Typography.bodyMd, color: EventColors.muted, lineHeight: 24 },
  followRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  followers: { ...Typography.labelMd, color: Colors.onSurface },
  followBtn: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: EventColors.brand, borderWidth: 1, borderColor: EventColors.brand },
  followBtnOn: { backgroundColor: 'transparent' },
  followBtnDisabled: { opacity: 0.5 },
  followText: { ...Typography.labelMd, color: Colors.onPrimary },
  followTextOn: { color: EventColors.brand },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.md },
  empty: { ...Typography.bodyMd, color: EventColors.muted },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  eventThumb: { width: 56, height: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  eventEmoji: { fontSize: 28 },
  eventBody: { flex: 1, gap: 2 },
  eventTitle: { ...Typography.titleMd, color: Colors.onSurface },
  eventMeta: { ...Typography.caption, color: EventColors.muted },
});
