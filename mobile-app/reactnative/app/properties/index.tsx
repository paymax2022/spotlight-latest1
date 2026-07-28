import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { User } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useProperties } from '@/features/properties/hooks';
import { TYPE_META, OCCUPANCY_META } from '@/features/properties/api';
import type { Property, OccupancyStatus } from '@/features/properties/api';

const FILTERS: (OccupancyStatus | 'all')[] = ['all', 'occupied', 'vacant', 'reserved'];

export default function PropertiesScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useProperties();
  const [filter, setFilter] = useState<OccupancyStatus | 'all'>('all');
  const filtered = useMemo(() => (data?.properties ?? []).filter((p) => filter === 'all' || p.occupancyStatus === filter), [data, filter]);

  const renderItem = ({ item }: { item: Property }) => {
    const t = TYPE_META[item.propertyType]; const oc = OCCUPANCY_META[item.occupancyStatus];
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[t.icon] ?? Icons.Building;
    const who = item.tenantName ?? item.landlordName;
    return (
      <View style={styles.card}>
        <View style={styles.iconBox}><Icon size={20} color={Colors.primary} strokeWidth={1.8} /></View>
        <View style={styles.body}>
          <View style={styles.topRow}>
            <Text style={styles.title} numberOfLines={1}>{item.unitLabel}</Text>
            <View style={[styles.chip, { backgroundColor: oc.bg }]}><Text style={[styles.chipText, { color: oc.color }]}>{oc.label}</Text></View>
          </View>
          <Text style={styles.meta}>{t.label}{item.block ? ` · Block ${item.block}` : ''}{item.floor ? ` · Flr ${item.floor}` : ''}</Text>
          {who ? <View style={styles.whoRow}><User size={12} color={Colors.onSurfaceVariant} strokeWidth={1.8} /><Text style={styles.meta} numberOfLines={1}>{item.tenantName ? `${item.tenantName} (tenant)` : `${item.landlordName} (owner)`}</Text></View> : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Properties" />
      {data ? (
        <View style={styles.summary}>
          <Stat label="Units" value={String(data.summary.total)} />
          <Stat label="Occupied" value={String(data.summary.occupied)} accent={OCCUPANCY_META.occupied.color} />
          <Stat label="Vacant" value={String(data.summary.vacant)} accent={OCCUPANCY_META.vacant.color} />
          <Stat label="Occupancy" value={`${data.summary.occupancyRate}%`} />
        </View>
      ) : null}
      {data ? (
        <View style={styles.segment}>
          {FILTERS.map((f) => {
            const selected = f === filter;
            return (
              <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="tab" accessibilityState={{ selected }} style={[styles.segItem, selected && { backgroundColor: Colors.surfaceContainerLowest }]}>
                <Text style={[styles.segText, selected && { color: Colors.primary }]} numberOfLines={1}>{f === 'all' ? 'All' : OCCUPANCY_META[f].label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {isLoading ? <StateView kind="loading" message="Loading properties…" />
        : isError ? <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
        : (
          <FlatList data={filtered} keyExtractor={(p) => p.id} renderItem={renderItem} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} refreshing={isRefetching} onRefresh={refetch} ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            ListEmptyComponent={<StateView kind="empty" icon="Building2" title="No properties" message="Registered units appear here." />} />
        )}
    </SafeAreaView>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  summary: { flexDirection: 'row', marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, paddingVertical: Spacing.md, ...shadow1 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  segment: { flexDirection: 'row', marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: 4, gap: 4 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.DEFAULT },
  segText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chip: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { ...Typography.labelSm, fontWeight: '700' },
});
