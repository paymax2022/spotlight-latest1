import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { MapPin, Clock, Users, User, Radar } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useOffer } from '@/features/mobility/hooks/useEvent';
import { EVENT_OFFER_TYPES, OFFER_STATUS_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNaira } from '@/features/mobility/utils/mobilityFormatters';
import type { EventOfferType, OfferStatus } from '@/features/mobility/types/event.types';

const dt = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const typeIcon = (t: EventOfferType) => EVENT_OFFER_TYPES.find((x) => x.value === t)?.icon ?? 'Bus';
const typeLabel = (t: EventOfferType) => EVENT_OFFER_TYPES.find((x) => x.value === t)?.label ?? t;

function statusTone(s: OfferStatus) {
  if (s === 'completed') return 'success' as const;
  if (s === 'full') return 'warning' as const;
  if (s === 'cancelled') return 'danger' as const;
  if (s === 'open') return 'info' as const;
  return 'neutral' as const;
}

export default function OfferDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offer = useOffer(id);
  const o = offer.data;

  if (offer.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Transport offer" /><StateView kind="loading" message="Loading offer…" /></SafeAreaView>
    );
  }
  if (offer.isError || !o) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Transport offer" /><MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => offer.refetch()} /></SafeAreaView>
    );
  }

  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[typeIcon(o.type)] ?? Icons.Bus;
  const seatsLeft = Math.max(0, o.capacity - o.bookedCount);
  const bookable = o.status === 'open' && seatsLeft > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Transport offer" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.card, shadow1]}>
          <View style={styles.headRow}>
            <View style={styles.typeIcon}><Icon size={24} color={Colors.primary} strokeWidth={2.2} /></View>
            <StatusBadge label={OFFER_STATUS_LABEL[o.status]} tone={statusTone(o.status)} />
          </View>
          <Text style={styles.title}>{o.title}</Text>
          <Text style={styles.type}>{typeLabel(o.type)}</Text>

          <View style={styles.divider} />

          <Row icon={<MapPin size={16} color={Colors.primary} strokeWidth={2} />} label="Venue" value={o.venue} />
          <Row icon={<Clock size={16} color={Colors.secondary} strokeWidth={2} />} label="Departure" value={dt(o.departureTime)} />
          <Row icon={<Users size={16} color={Colors.tertiaryContainer} strokeWidth={2} />} label="Seats" value={`${seatsLeft} of ${o.capacity} available`} />
          <Row icon={<User size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Organizer" value={o.organizerName} />
          {o.pickupZone ? <Row icon={<MapPin size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} label="Pickup zone" value={o.pickupZone} /> : null}
        </View>

        {o.geofenceRadiusM != null && (
          <View style={styles.geoCard}>
            <Radar size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.geoText}>Venue geofencing active within {o.geofenceRadiusM}m. Boarding is validated inside this zone.</Text>
          </View>
        )}

        <View style={styles.fareCard}>
          <Text style={styles.fareLabel}>Per seat</Text>
          <Text style={styles.fareValue}>{formatNaira(o.fareKobo)}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={bookable ? 'Book seats' : o.status === 'full' || seatsLeft === 0 ? 'Sold out' : 'Unavailable'}
          onPress={() => router.push(`/mobility/events/book/${o.id}`)}
          disabled={!bookable}
        />
      </View>
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 4 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  typeIcon: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  type: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface },
  geoCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.secondaryFixed, borderRadius: Radius.lg, padding: Spacing.md },
  geoText: { ...Typography.labelSm, color: Colors.onSecondaryFixed, flex: 1, lineHeight: 18 },
  fareCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  fareLabel: { ...Typography.labelLg, color: Colors.onSurface },
  fareValue: { ...Typography.titleMd, color: Colors.primary, fontWeight: '800' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
