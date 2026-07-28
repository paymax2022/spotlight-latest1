import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Music, UtensilsCrossed, DoorOpen, Store, Bath, Cross } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useVenueMap } from '@/features/events/hooks';
import { EventColors } from '@/features/events/constants/events.constants';
import type { VenueZone } from '@/features/events/types';

const ZONE_META: Record<VenueZone['type'], { Icon: typeof Music; color: string }> = {
  stage:    { Icon: Music,            color: '#A855F7' },
  food:     { Icon: UtensilsCrossed,  color: '#EF4444' },
  entry:    { Icon: DoorOpen,         color: EventColors.ok },
  vendor:   { Icon: Store,            color: EventColors.accent },
  restroom: { Icon: Bath,             color: EventColors.muted },
  medical:  { Icon: Cross,            color: EventColors.danger },
};

const MAP_W = 320;
const MAP_H = 380;

export default function VenueMap() {
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = params.eventId ?? 'e_live';
  const { data, isLoading, isError, refetch } = useVenueMap(eventId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Venue map" />
      {isLoading ? (
        <StateView kind="loading" message="Loading map…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load map" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : data.length === 0 ? (
        <StateView kind="empty" title="No map yet" message="The organiser hasn't published a venue map." icon="MapPin" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.mapWrap}>
            <View style={[styles.map, { width: MAP_W, height: MAP_H }]}>
              {data.map((z) => {
                const meta = ZONE_META[z.type];
                return (
                  <View key={z.id} style={[styles.pin, { left: z.x * MAP_W - 20, top: z.y * MAP_H - 20 }]}>
                    <View style={[styles.pinIcon, { backgroundColor: meta.color }]}>
                      <meta.Icon size={18} color={Colors.white} strokeWidth={2} />
                    </View>
                    <Text style={styles.pinLabel} numberOfLines={1}>{z.name}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <Text style={styles.legendTitle}>Legend</Text>
          <View style={styles.legend}>
            {data.map((z) => {
              const meta = ZONE_META[z.type];
              return (
                <View key={z.id} style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: meta.color }]}><meta.Icon size={13} color={Colors.white} /></View>
                  <Text style={styles.legendText}>{z.name}</Text>
                </View>
              );
            })}
          </View>
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingTop: Spacing.sm },
  mapWrap: { alignItems: 'center' },
  map: { backgroundColor: Colors.surfaceContainer, borderRadius: Radius.xl, position: 'relative', overflow: 'hidden' },
  pin: { position: 'absolute', alignItems: 'center', width: 80 },
  pinIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', ...shadow1 },
  pinLabel: { ...Typography.caption, color: Colors.onSurface, marginTop: 2, textAlign: 'center' },
  legendTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  legend: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, ...shadow1 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  legendDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  legendText: { ...Typography.bodyMd, color: Colors.onSurface },
});
