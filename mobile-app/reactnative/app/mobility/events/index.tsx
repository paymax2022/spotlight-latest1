import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Ticket, MapPin, Clock, Users, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useEventOffers } from '@/features/mobility/hooks/useEvent';
import { EVENT_ENABLED, EVENT_OFFER_TYPES, OFFER_STATUS_LABEL } from '@/features/mobility/constants/modes.constants';
import { DEMO_EVENT_ID, DEMO_EVENT_TITLE } from '@/features/mobility/api/event.mock';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { EventTransportOffer, EventOfferType, OfferStatus } from '@/features/mobility/types/event.types';

const dt = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const typeIcon = (t: EventOfferType) => EVENT_OFFER_TYPES.find((x) => x.value === t)?.icon ?? 'Bus';
const typeLabel = (t: EventOfferType) => EVENT_OFFER_TYPES.find((x) => x.value === t)?.label ?? t;

function statusTone(s: OfferStatus) {
  if (s === 'completed') return 'success' as const;
  if (s === 'full') return 'warning' as const;
  if (s === 'cancelled') return 'danger' as const;
  if (s === 'open') return 'info' as const;
  return 'neutral' as const;
}

export default function EventTransportScreen() {
  const [filter, setFilter] = useState<EventOfferType | 'all'>('all');
  const offers = useEventOffers(DEMO_EVENT_ID);

  if (!EVENT_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Event transport" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const all = offers.data ?? [];
  const list = filter === 'all' ? all : all.filter((o) => o.type === filter);
  const presentTypes = EVENT_OFFER_TYPES.filter((t) => all.some((o) => o.type === t.value));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Event transport"
        subtitle={DEMO_EVENT_TITLE}
        rightSlot={
          <Pressable onPress={() => router.push('/mobility/events/bookings')} hitSlop={8} accessibilityLabel="My bookings">
            <Ticket size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        {presentTypes.map((t) => (
          <Chip key={t.value} label={t.label} active={filter === t.value} onPress={() => setFilter(t.value)} />
        ))}
      </ScrollView>

      {offers.isLoading ? (
        <StateView kind="loading" message="Loading transport options…" />
      ) : offers.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => offers.refetch()} />
      ) : list.length === 0 ? (
        <MobilityEdgeState kind="empty" title="No transport offers" message="There are no rides for this event yet." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={offers.isRefetching} onRefresh={() => offers.refetch()} tintColor={Colors.primary} />}
        >
          {list.map((o) => (
            <OfferCard key={o.id} o={o} onPress={() => router.push(`/mobility/events/offer/${o.id}`)} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function OfferCard({ o, onPress }: { o: EventTransportOffer; onPress: () => void }) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[typeIcon(o.type)] ?? Icons.Bus;
  const seatsLeft = Math.max(0, o.capacity - o.bookedCount);
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardHead}>
        <View style={styles.typeIcon}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{o.title}</Text>
          <Text style={styles.cardType}>{typeLabel(o.type)}</Text>
        </View>
        <StatusBadge label={OFFER_STATUS_LABEL[o.status]} tone={statusTone(o.status)} />
      </View>

      <View style={styles.metaRow}><MapPin size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText} numberOfLines={1}>{o.venue}</Text></View>
      <View style={styles.metaRow}><Clock size={14} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>{dt(o.departureTime)}</Text></View>

      <View style={styles.footRow}>
        <View style={styles.seatsRow}>
          <Users size={14} color={seatsLeft === 0 ? Colors.error : Colors.tertiaryContainer} strokeWidth={2} />
          <Text style={[styles.seats, seatsLeft === 0 && styles.seatsFull]}>{seatsLeft === 0 ? 'Full' : `${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left`}</Text>
        </View>
        <View style={styles.fareRow}>
          <Text style={styles.fare}>{formatNairaWhole(o.fareKobo)}</Text>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  chips: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingVertical: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipLabelActive: { color: Colors.primary },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs, paddingBottom: Spacing.lg, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  typeIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cardType: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  seatsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  seats: { ...Typography.labelSm, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  seatsFull: { color: Colors.error },
  fareRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fare: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '800' as const },
});
