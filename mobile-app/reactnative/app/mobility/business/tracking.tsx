import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import StatusBadge from '@/features/mobility/components/StatusBadge';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useDeliveries } from '@/features/mobility/hooks/useLogistics';
import { LOGISTICS_ENABLED, DELIVERY_STATUS_LABEL } from '@/features/mobility/constants/modes.constants';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import type { Delivery, DeliveryStatus } from '@/features/mobility/types/logistics.types';

const FILTERS: { value: DeliveryStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'created', label: 'Created' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'picked_up', label: 'Picked up' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusTone(s: DeliveryStatus) {
  if (s === 'delivered') return 'success' as const;
  if (s === 'failed' || s === 'cancelled') return 'danger' as const;
  if (s === 'picked_up') return 'info' as const;
  return 'neutral' as const;
}

export default function TrackingScreen() {
  const [filter, setFilter] = useState<DeliveryStatus | 'all'>('all');
  const deliveries = useDeliveries(filter === 'all' ? undefined : filter);

  if (!LOGISTICS_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Track deliveries" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const list = deliveries.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Track deliveries" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <Pressable key={f.value} style={[styles.chip, active && styles.chipActive]} onPress={() => setFilter(f.value)}>
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {deliveries.isLoading ? (
        <StateView kind="loading" message="Loading deliveries…" />
      ) : deliveries.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => deliveries.refetch()} />
      ) : list.length === 0 ? (
        <MobilityEdgeState kind="empty" title="No deliveries here" message="Nothing matches this filter yet." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={deliveries.isRefetching} onRefresh={() => deliveries.refetch()} tintColor={Colors.primary} />}
        >
          {list.map((d) => (
            <Row key={d.id} d={d} onPress={() => router.push(`/mobility/business/delivery/${d.id}`)} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ d, onPress }: { d: Delivery; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{d.receiverName}</Text>
        <Text style={styles.rowAddr} numberOfLines={1}>{d.dropoff.address}</Text>
        <View style={styles.rowMeta}>
          <StatusBadge label={DELIVERY_STATUS_LABEL[d.status]} tone={statusTone(d.status)} />
          <Text style={styles.rowFare}>{formatNairaWhole(d.fareKobo)}</Text>
        </View>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowAddr: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  rowFare: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
});
