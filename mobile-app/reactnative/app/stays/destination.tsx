import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { MapPin, Building2, Navigation, Landmark } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import MapView, { type MapMarker } from '@/features/mobility/components/MapView';
import { resolveCoordinate } from '@/lib/addressLookup';
import { useDestinations } from '@/features/stays/hooks';
import { useStaysStore } from '@/features/stays/store';
import type { DestinationSuggestion } from '@/features/stays/types';

const KIND_ICON = {
  city: Building2,
  area: MapPin,
  landmark: Landmark,
} as const;

// Nigeria — a wide default center until a destination resolves to a pin.
const DEFAULT_CENTER = { lat: 9.082, lng: 8.6753 };

export default function DestinationScreen() {
  const [q, setQ] = useState('');
  const list = useDestinations(q);
  const { setQuery } = useStaysStore();
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const resolveSeq = useRef(0);

  // The map previews the TOP visible destination (first result, or the first
  // popular one when the search is empty) so it always reflects what "Where
  // to?" would actually select if the user tapped now — updates as they type,
  // same live-preview pattern AddressEntry uses for a precise address, just
  // resolved from the city name instead of a draggable pin.
  const topDestination = list.data?.[0];
  useEffect(() => {
    const seq = ++resolveSeq.current;
    if (!topDestination) {
      setPin(null);
      return;
    }
    resolveCoordinate({
      id: topDestination.id,
      label: `${topDestination.name}, ${topDestination.region}`,
      primary: topDestination.name,
      secondary: topDestination.region,
      source: 'proxy',
    }).then((resolved) => {
      if (seq !== resolveSeq.current) return; // a newer destination superseded this lookup
      if (resolved) setPin({ lat: resolved.lat, lng: resolved.lng });
    });
  }, [topDestination]);

  const markers: MapMarker[] = pin
    ? [{ id: 'destination-preview', lat: pin.lat, lng: pin.lng, color: Colors.primary, title: topDestination?.name }]
    : [];

  const pick = (d: DestinationSuggestion) => {
    setQuery({ destination: d.name, destinationId: d.id });
    goBack('/stays');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Where to?" />
      <SearchBar value={q} onChangeText={setQ} autoFocus placeholder="City, area or hotel name" />

      <Pressable style={styles.nearRow} onPress={() => { setQuery({ destination: 'Near me', destinationId: undefined }); goBack('/stays'); }}>
        <View style={styles.nearIcon}><Navigation size={18} color={Colors.secondary} strokeWidth={2} /></View>
        <Text style={styles.nearText}>Use my current location</Text>
      </Pressable>

      <View style={styles.mapCard}>
        <MapView
          center={pin ?? DEFAULT_CENTER}
          zoom={pin ? 11 : 5}
          markers={markers}
          style={styles.map}
        />
        {topDestination && (
          <View style={styles.mapLabel}>
            <MapPin size={14} color={Colors.primary} strokeWidth={2.5} />
            <Text style={styles.mapLabelText} numberOfLines={1}>{topDestination.name}, {topDestination.region}</Text>
          </View>
        )}
      </View>

      {list.isLoading ? (
        <StateView kind="loading" message="Searching…" compact />
      ) : list.isError ? (
        <StateView kind="error" title="Search failed" actionLabel="Retry" onAction={() => list.refetch()} />
      ) : (list.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="SearchX" title="No matches" message="Try another city or landmark." />
      ) : (
        <FlatList
          data={list.data}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={<Text style={styles.heading}>{q ? 'Results' : 'Popular destinations'}</Text>}
          renderItem={({ item }) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <Pressable style={styles.row} onPress={() => pick(item)}>
                <View style={styles.rowIcon}><Icon size={18} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.rowSub}>{item.region}</Text>
                </View>
                <Text style={styles.count}>{item.propertyCount}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  nearRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, marginBottom: Spacing.sm },
  nearIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  nearText: { ...Typography.labelLg, color: Colors.secondary },
  mapCard: {
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.md,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerLow,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 2,
  },
  map: { height: 160, borderRadius: 0 },
  mapLabel: {
    position: 'absolute',
    left: Spacing.sm,
    bottom: Spacing.sm,
    right: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  mapLabelText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const, flexShrink: 1 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  heading: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  rowSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  count: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
