import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight, Navigation } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StatusBadge from './StatusBadge';
import { formatNairaWhole, formatEta } from '../utils/mobilityFormatters';
import { SERVICE_TYPE_LABEL } from '../constants/mobility.constants';
import type { Trip } from '../types/mobility.types';

interface Props {
  trip: Trip;
  onPress: () => void;
}

/** Resumable active-trip card shown on the mobility home. */
export default function ActiveTripCard({ trip, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={[styles.card, shadow1]} accessibilityLabel="Open active trip">
      <View style={styles.iconWrap}>
        <Navigation size={20} color={Colors.primary} strokeWidth={2.2} />
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.title}>{SERVICE_TYPE_LABEL[trip.serviceType]} trip</Text>
          <StatusBadge phase={trip.phase} />
        </View>
        <Text style={styles.dest} numberOfLines={1}>To {trip.dest.label ?? trip.dest.address}</Text>
        <Text style={styles.meta}>
          {formatNairaWhole(trip.fareKobo)}
          {trip.driverEtaS != null ? ` · driver ${formatEta(trip.driverEtaS)}` : ''}
        </Text>
      </View>
      <ChevronRight size={20} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  iconWrap: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  dest: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  meta: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const, marginTop: 2 },
});
