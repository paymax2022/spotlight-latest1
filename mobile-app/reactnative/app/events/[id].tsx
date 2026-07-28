import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Calendar, MapPin, Wallet } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useEvent } from '@/features/events/hooks';
import { EventColors, formatNaira, eventCoverEmoji, eventBannerColor } from '@/features/events/constants/events.constants';

function dt(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: e, isLoading, isError, refetch } = useEvent(id ?? '');

  if (isLoading) return <Shell><StateView kind="loading" message="Loading event…" /></Shell>;
  if (isError || !e) return <Shell><StateView kind="error" title="Couldn't load event" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Shell>;

  const onSale = e.state === 'LIVE' || e.state === 'APPROVED';
  const activeTiers = e.tiers.filter((t) => t.active);
  const fromPriceKobo = activeTiers.length ? Math.min(...activeTiers.map((t) => t.price_kobo)) : 0;
  const cashlessEnabled = true; // every event supports the shared closed-loop wallet module

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Event" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.cover, { backgroundColor: eventBannerColor(e.id, e.category) }]}>
          <Text style={styles.coverEmoji}>{eventCoverEmoji(e.category)}</Text>
        </View>

        <Text style={styles.title}>{e.title}</Text>

        <View style={styles.metaCard}>
          <Meta Icon={Calendar} text={dt(e.starts_at)} />
          <Meta Icon={MapPin} text={e.venue} />
          {cashlessEnabled ? <Meta Icon={Wallet} text="Cashless event wallet enabled" /> : null}
        </View>

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
