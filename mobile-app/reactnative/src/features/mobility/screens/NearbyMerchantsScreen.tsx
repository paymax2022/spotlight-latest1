import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import MapView, { type MapMarker } from '../components/MapView';
import AddressEntry, { type ConfirmedAddress } from '../components/AddressEntry';
import { useNearbyOwn } from '../hooks/useNearby';
import { upsertLocation } from '../api/maps.api';

type EntityType = 'restaurant' | 'estate' | 'realtor_property';
const ENTITY_TYPES: { key: EntityType; label: string }[] = [
  { key: 'restaurant', label: 'Restaurants' },
  { key: 'estate', label: 'Estates' },
  { key: 'realtor_property', label: 'Properties' },
];

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * NearbyMerchantsScreen demonstrates the whole MapService loop on mobile:
 *   1) AddressEntry captures a confirmed pin + Plus Code (Nigeria rule),
 *   2) optionally upsertLocation() writes it into merchant_locations,
 *   3) useNearbyOwn() reads neighbours back via PostGIS ST_DWithin (no maps API).
 *
 * The same flow powers restaurant/estate/realtor "near me", since those tables
 * sync into merchant_locations.
 */
export default function NearbyMerchantsScreen() {
  const [entityType, setEntityType] = useState<EntityType>('restaurant');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [lastPlusCode, setLastPlusCode] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const radiusM = 3000;
  const nearby = useNearbyOwn(entityType, pin, radiusM);

  const onConfirmed = (addr: ConfirmedAddress) => {
    setPin({ lat: addr.lat, lng: addr.lng });
    setLastPlusCode(addr.plusCode);
    setNote(null);
  };

  // Demo write path: register the confirmed pin as a record of the selected type,
  // so it immediately shows up in "near me".
  const registerHere = async () => {
    if (!pin) return;
    try {
      const res = await upsertLocation(randomId(), entityType, pin.lat, pin.lng, lastPlusCode || undefined);
      setNote(`Saved a ${entityType} here (Plus Code ${res.plus_code}).`);
      nearby.refetch();
    } catch {
      setNote('Could not save the location — are you signed in?');
    }
  };

  const results = nearby.data ?? [];
  const markers: MapMarker[] = [
    ...(pin ? [{ id: 'me', lat: pin.lat, lng: pin.lng, title: 'You', color: '#2563eb', source: 'own' as const }] : []),
    ...results.map((r) => ({
      id: r.entity_id,
      lat: r.lat,
      lng: r.lng,
      title: `${r.entity_type} · ${fmtDistance(r.distance_m)}`,
      color: '#16a34a',
      source: 'own' as const,
    })),
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Near me" subtitle="Find places around a confirmed pin" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Entity-type selector */}
        <View style={styles.segment}>
          {ENTITY_TYPES.map((t) => {
            const active = t.key === entityType;
            return (
              <Pressable
                key={t.key}
                onPress={() => setEntityType(t.key)}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Pin capture */}
        <Text style={styles.sectionLabel}>1 · Drop a pin for where you are</Text>
        <AddressEntry surface="delivery" onConfirmed={onConfirmed} />

        {pin && (
          <Pressable style={styles.secondaryBtn} onPress={registerHere}>
            <Text style={styles.secondaryBtnText}>Save a demo {entityType} at this pin</Text>
          </Pressable>
        )}
        {note && <Text style={styles.note}>{note}</Text>}

        {/* Results map + list */}
        <Text style={styles.sectionLabel}>2 · {ENTITY_TYPES.find((t) => t.key === entityType)!.label} within 3 km</Text>

        {!pin ? (
          <StateView kind="empty" title="Confirm a pin first" message="Drop and confirm a pin above to search nearby." compact />
        ) : nearby.isLoading ? (
          <StateView kind="loading" compact />
        ) : nearby.isError ? (
          <StateView kind="error" title="Couldn't load nearby places" actionLabel="Retry" onAction={() => nearby.refetch()} compact />
        ) : (
          <>
            <MapView center={pin} zoom={14} markers={markers} style={styles.map} />
            {results.length === 0 ? (
              <StateView kind="empty" title="Nothing nearby yet" message="Save a demo location above to see it appear here." compact />
            ) : (
              <View style={styles.list}>
                {results.map((r, i) => (
                  <View key={r.entity_id}>
                    <View style={styles.row}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {r.plus_code || r.entity_id.slice(0, 8)}
                      </Text>
                      <Text style={styles.rowDist}>{fmtDistance(r.distance_m)}</Text>
                    </View>
                    {i < results.length - 1 && <View style={styles.divider} />}
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.md },
  segment: { flexDirection: 'row', backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.md, padding: 3 },
  segmentBtn: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: Radius.md },
  segmentBtnActive: { backgroundColor: Colors.surfaceContainerLowest },
  segmentText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  segmentTextActive: { color: Colors.onSurface },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  secondaryBtn: {
    borderWidth: 1, borderColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.sm, alignItems: 'center',
  },
  secondaryBtnText: { ...Typography.labelMd, color: Colors.primary },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  map: { height: 280 },
  list: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  rowTitle: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, marginRight: Spacing.md },
  rowDist: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
