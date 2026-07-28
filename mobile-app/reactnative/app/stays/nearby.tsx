import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Navigation, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { MapMarker, PropertyCard } from '@/features/stays/components';
import { useNearbyStays, useToggleSaved } from '@/features/stays/hooks';
import { isSavedSync } from '@/features/stays/api';
import { StaysColors } from '@/features/stays/constants/stays.constants';

// Deterministic pseudo-positions for the schematic map (no native map dep).
function pinPos(i: number, total: number) {
  const cols = 3;
  const row = Math.floor(i / cols);
  const col = i % cols;
  return { left: `${12 + col * 30}%`, top: `${15 + row * 26}%` };
}

export default function NearbyScreen() {
  const list = useNearbyStays();
  const toggleSave = useToggleSaved();
  const [active, setActive] = useState<string | null>(null);

  const items = list.data ?? [];
  const activeItem = items.find((p) => p.id === active) ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Nearby stays" subtitle="Sorted by distance" />

      {list.isLoading ? (
        <StateView kind="loading" message="Finding stays near you…" />
      ) : list.isError ? (
        <StateView kind="error" title="Location unavailable" message="We couldn't load nearby stays." actionLabel="Retry" onAction={() => list.refetch()} />
      ) : items.length === 0 ? (
        <StateView kind="empty" icon="MapPinOff" title="Nothing nearby" message="Try searching a city instead." />
      ) : (
        <>
          {/* Schematic map canvas */}
          <View style={styles.map}>
            <View style={styles.meDot}><Navigation size={14} color={Colors.onPrimary} strokeWidth={2.4} /></View>
            {items.slice(0, 6).map((p, i) => (
              <View key={p.id} style={[styles.pin, pinPos(i, items.length) as any]}>
                <MapMarker
                  priceMinor={p.leadPriceMinor}
                  currency={p.currency}
                  soldOut={p.soldOut}
                  active={p.id === active}
                  onPress={() => setActive(p.id)}
                />
              </View>
            ))}
            <View style={styles.mapNote}>
              <MapPin size={12} color={Colors.onSurfaceVariant} />
              <Text style={styles.mapNoteText}>Tap a price pin to preview</Text>
            </View>
          </View>

          {activeItem ? (
            <View style={styles.preview}>
              <PropertyCard
                property={activeItem}
                variant="rail"
                saved={isSavedSync(activeItem.id)}
                onToggleSave={() => toggleSave.mutate(activeItem.id)}
                onPress={() => router.push(`/stays/property/${activeItem.id}`)}
              />
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(p) => p.id}
              contentContainerStyle={styles.list}
              ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
              renderItem={({ item }) => (
                <PropertyCard
                  property={item}
                  saved={isSavedSync(item.id)}
                  onToggleSave={() => toggleSave.mutate(item.id)}
                  onPress={() => router.push(`/stays/property/${item.id}`)}
                />
              )}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  map: { height: 280, marginHorizontal: Spacing.containerMargin, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerHigh, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden' },
  meDot: { position: 'absolute', left: '46%', top: '46%', width: 30, height: 30, borderRadius: 15, backgroundColor: StaysColors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: Colors.surfaceContainerLowest },
  pin: { position: 'absolute' },
  mapNote: { position: 'absolute', bottom: Spacing.sm, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLowest, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  mapNoteText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  preview: { padding: Spacing.containerMargin },
  list: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, paddingBottom: Spacing.xxl },
});
