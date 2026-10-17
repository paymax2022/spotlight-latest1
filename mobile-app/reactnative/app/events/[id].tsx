import React from 'react';
import { View, Text, ScrollView, StyleSheet, Image, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Calendar, MapPin, Wallet, Heart } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import MapView from '@/features/mobility/components/MapView';
import { useEvent, useLikeEvent } from '@/features/events/hooks';
import { venueMapState } from '@/features/events/venue';
import { EventColors, formatNaira, eventCoverEmoji, eventBannerColor } from '@/features/events/constants/events.constants';

// events-social flag: exactly the string 'true' turns it on; default off.
const EVENTS_SOCIAL = process.env.EXPO_PUBLIC_EVENTS_SOCIAL === 'true';

function dt(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: e, isLoading, isError, refetch } = useEvent(id ?? '');
  // Hooks run before the early returns below. Same query key as useEvent, so no
  // second request; the like state is only read once the event has loaded.
  const like = useLikeEvent(id ?? '');

  if (isLoading) return <Shell><StateView kind="loading" message="Loading event…" /></Shell>;
  if (isError || !e) return <Shell><StateView kind="error" title="Couldn't load event" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Shell>;

  const onSale = e.state === 'LIVE' || e.state === 'APPROVED';
  const activeTiers = e.tiers.filter((t) => t.active);
  const fromPriceKobo = activeTiers.length ? Math.min(...activeTiers.map((t) => t.price_kobo)) : 0;
  const showBanner = EVENTS_SOCIAL && !!e.banner_url;
  const showMap = EVENTS_SOCIAL && venueMapState(e) === 'pin';
  const cashlessEnabled = true; // every event supports the shared closed-loop wallet module

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Event" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.cover, { backgroundColor: eventBannerColor(e.id, e.category) }]}>
          {showBanner ? (
            <Image source={{ uri: e.banner_url as string }} style={styles.coverImage} resizeMode="cover" accessibilityLabel={`${e.title} banner`} />
          ) : (
            <Text style={styles.coverEmoji}>{eventCoverEmoji(e.category)}</Text>
          )}
        </View>

        <Text style={styles.title}>{e.title}</Text>

        {EVENTS_SOCIAL ? (
          <View style={styles.socialRow}>
            <Pressable
              onPress={like.toggle}
              disabled={isLoading || like.isPending}
              accessibilityRole="button"
              accessibilityLabel={like.state.liked ? 'Unlike this event' : 'Like this event'}
              accessibilityState={{ disabled: isLoading || like.isPending, selected: like.state.liked }}
              style={[styles.likeBtn, (isLoading || like.isPending) && styles.likeBtnDisabled]}
            >
              <Heart size={20} color={like.state.liked ? EventColors.brand : EventColors.muted} fill={like.state.liked ? EventColors.brand : 'none'} strokeWidth={1.8} />
              <Text style={styles.likeCount}>{like.state.count}</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: '/events/organiser/[id]', params: { id: e.organiser_id } })}
              accessibilityRole="link"
              accessibilityLabel="View organiser"
              hitSlop={8}
            >
              <Text style={styles.organiserLink}>View organiser</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.metaCard}>
          <Meta Icon={Calendar} text={dt(e.starts_at)} />
          <Meta Icon={MapPin} text={e.venue} />
          {cashlessEnabled ? <Meta Icon={Wallet} text="Cashless event wallet enabled" /> : null}
        </View>

        {showMap ? (
          <MapView
            surface="events"
            center={{ lat: e.venue_lat as number, lng: e.venue_lng as number }}
            zoom={15}
            markers={[{ id: e.id, lat: e.venue_lat as number, lng: e.venue_lng as number, title: e.venue }]}
            style={styles.map}
          />
        ) : null}

        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.body}>{e.description}</Text>

        <Text style={styles.sectionTitle}>Tickets from</Text>
        <Text style={styles.fromPrice}>{fromPriceKobo === 0 ? 'Free' : formatNaira(fromPriceKobo)}</Text>

        {cashlessEnabled ? (
          <PrimaryButton label="Open event wallet" variant="secondary" onPress={() => router.push({ pathname: '/events/wallet/top-up', params: { eventId: e.id } })} style={{ marginTop: Spacing.md }} />
        ) : null}

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.footer}>
        {onSale ? (
          <PrimaryButton label="Get tickets" onPress={() => router.push({ pathname: '/events/checkout/tiers', params: { eventId: e.id } })} />
        ) : (
          <PrimaryButton label={e.state === 'CLOSED' ? 'Event ended' : 'Not on sale yet'} onPress={() => {}} disabled />
        )}
      </View>
    </SafeAreaView>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Event" />
      {children}
    </SafeAreaView>
  );
}

function Meta({ Icon, text }: { Icon: typeof Calendar; text: string }) {
  return (
    <View style={styles.metaRow}>
      <Icon size={18} color={EventColors.brand} strokeWidth={1.8} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  cover: { height: 180, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  coverEmoji: { fontSize: 72 },
  coverImage: { width: '100%', height: '100%', borderRadius: Radius.xl },
  socialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.xs, paddingRight: Spacing.sm },
  likeBtnDisabled: { opacity: 0.5 },
  likeCount: { ...Typography.bodyMd, color: Colors.onSurface },
  organiserLink: { ...Typography.bodyMd, color: EventColors.brand, textDecorationLine: 'underline' },
  map: { height: 200, borderRadius: Radius.lg },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  organiser: { ...Typography.bodyMd, color: EventColors.muted },
  metaCard: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md, marginTop: Spacing.sm, ...shadow1 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  metaText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.md },
  body: { ...Typography.bodyMd, color: EventColors.muted, lineHeight: 24 },
  fromPrice: { ...Typography.headlineMd, color: EventColors.brand },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
