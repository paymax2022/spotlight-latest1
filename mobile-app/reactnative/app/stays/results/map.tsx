import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { List } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { MapMarker, PropertyCard } from '@/features/stays/components';
import { useSearchStays, useToggleSaved } from '@/features/stays/hooks';
import { isSavedSync } from '@/features/stays/api';
import { useStaysStore } from '@/features/stays/store';

function pinPos(i: number) {
  const cols = 3;
  return { left: `${10 + (i % cols) * 30}%`, top: `${12 + Math.floor(i / cols) * 24}%` };
}

export default function ResultsMap() {
  const { query, filter } = useStaysStore();
  const results = useSearchStays(query, filter);
  const toggleSave = useToggleSaved();
  const [active, setActive] = useState<string | null>(null);

  const items = results.data ?? [];
  const activeItem = items.find((p) => p.id === active) ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Map"
        subtitle={query.destination || 'Search results'}
        rightSlot={
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="List view">
            <List size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {results.isLoading ? (
        <StateView kind="loading" message="Loading map…" />
      ) : results.isError ? (
        <StateView kind="error" title="Map failed" actionLabel="Retry" onAction={() => results.refetch()} />
      ) : items.length === 0 ? (
        <StateView kind="empty" icon="MapPinOff" title="No stays on the map" message="Adjust filters to see results." />
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.map}>
            {items.map((p, i) => (
              <View key={p.id} style={[styles.pin, pinPos(i) as any]}>
                <MapMarker
                  priceMinor={p.leadPriceMinor}
                  currency={p.currency}
                  soldOut={p.soldOut}
                  active={p.id === active}
                  onPress={() => setActive(p.id)}
                />
              </View>
            ))}
            <View style={styles.legend}>
              <Legend color={Colors.primary} label="Available" />
              <Legend color={Colors.error} label="Sold out" />
            </View>
          </View>

          {activeItem ? (
            <View style={styles.previewCard}>
              <PropertyCard
                property={activeItem}
                variant="rail"
                saved={isSavedSync(activeItem.id)}
                onToggleSave={() => toggleSave.mutate(activeItem.id)}
                onPress={() => !activeItem.soldOut && router.push(`/stays/property/${activeItem.id}`)}
              />
            </View>
          ) : (
            <View style={styles.hint}>
              <Text style={styles.hintText}>Tap a price pin to preview a stay</Text>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  map: { flex: 1, margin: Spacing.containerMargin, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerHigh, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden' },
  pin: { position: 'absolute' },
  legend: { position: 'absolute', top: Spacing.sm, left: Spacing.sm, flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...Typography.caption, color: Colors.onSurface },
  previewCard: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  hint: { alignItems: 'center', paddingBottom: Spacing.xl },
  hintText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
