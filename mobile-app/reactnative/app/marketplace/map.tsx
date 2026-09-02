// ── Screen 4 — Map View ──────────────────────────────────────────────────────
// Location-driven browsing. In a full native build this hosts clustered pins +
// a viewport-synced bottom card rail; the marketplace FOUNDATION ships a graceful
// fallback that renders the same viewport card rail over a map placeholder (the
// native MapLibre module is optional in this app — mobility guards on it the same
// way). Location-permission denial falls back to a city-center default with a
// permission-request banner, not a blank map.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, MapPin, List as ListIcon, Navigation } from 'lucide-react-native';
import * as Location from 'expo-location';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import { MarketColors, formatNaira } from '@/features/marketplace';
import type { SearchParams } from '@/features/marketplace';
import { useSearch } from '@/features/marketplace/hooks';
import { HomeMenuButton } from '@/components/HomeMenu';

// Lagos city-center default (used when permission is denied).
const DEFAULT_CENTER = { lat: 6.5244, lng: 3.3792, label: 'Lagos' };

export default function MarketplaceMap() {
  const raw = useLocalSearchParams<{ q?: string; categoryId?: string }>();
  const [permission, setPermission] = useState<'granted' | 'denied' | 'pending'>('pending');

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        setPermission(status === 'granted' ? 'granted' : 'denied');
      } catch {
        setPermission('denied');
      }
    })();
  }, []);

  const requestPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermission(status === 'granted' ? 'granted' : 'denied');
    } catch {
      setPermission('denied');
    }
  };

  const params: SearchParams = { q: raw.q || undefined, categoryId: raw.categoryId || undefined, sort: 'trusted_first', limit: 30 };
  const search = useSearch(params);
  const results = search.data?.results ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <Pressable onPress={() => goBack('/marketplace')} hitSlop={10} accessibilityLabel="Back to results"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.title}>Map view</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => goBack('/marketplace')} hitSlop={8} accessibilityLabel="List view"><ListIcon size={20} color={Colors.onSurface} /></Pressable>
          <HomeMenuButton />
        </View>
      </View>

      {/* Map surface (placeholder — clustered pins render here in native builds) */}
      <View style={styles.mapSurface}>
        <View style={styles.mapGrid} />
        <View style={styles.cluster}><Text style={styles.clusterText}>{results.length}</Text></View>
        <View style={styles.centerPin}><Navigation size={16} color="#FFFFFF" /></View>
        <Text style={styles.mapCaption}>{permission === 'granted' ? 'Near you' : DEFAULT_CENTER.label}</Text>

        {permission === 'denied' ? (
          <View style={styles.permBanner}>
            <MapPin size={14} color={MarketColors.warnText} />
            <Text style={styles.permText}>Showing {DEFAULT_CENTER.label} — enable location for nearby results</Text>
            <Pressable onPress={requestPermission}><Text style={styles.permAction}>Enable</Text></Pressable>
          </View>
        ) : null}
      </View>

      {/* Viewport card rail (bottom sheet substitute) */}
      <View style={styles.railWrap}>
        {search.isLoading && !search.data ? (
          <StateView kind="loading" message="Loading nearby listings…" compact />
        ) : results.length === 0 ? (
          <StateView kind="empty" icon="MapPinOff" title="Nothing here yet" message="Pan the map or widen your search." compact />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {results.map((l) => (
              <Pressable key={l.id} style={styles.railCard} onPress={() => router.push(`/marketplace/listing/${l.id}?source=map` as never)}>
                <View style={styles.railThumb} />
                <Text style={styles.railTitle} numberOfLines={1}>{l.title}</Text>
                <Text style={styles.railPrice}>{formatNaira(l.priceKobo)}</Text>
                <Text style={styles.railMeta} numberOfLines={1}>{l.lga ? `${l.lga}, ${l.state}` : l.state}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  mapSurface: { flex: 1, backgroundColor: Colors.surfaceContainer, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  mapGrid: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.surfaceContainerLow },
  cluster: { position: 'absolute', top: '30%', left: '28%', backgroundColor: MarketColors.brand, borderRadius: Radius.full, minWidth: 34, height: 34, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, ...shadow1 },
  clusterText: { ...Typography.labelLg, color: '#FFFFFF', fontWeight: '800' },
  centerPin: { width: 36, height: 36, borderRadius: 18, backgroundColor: MarketColors.accent, alignItems: 'center', justifyContent: 'center', ...shadow1 },
  mapCaption: { position: 'absolute', top: Spacing.md, ...Typography.labelMd, color: MarketColors.muted },
  permBanner: { position: 'absolute', bottom: Spacing.md, left: Spacing.md, right: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: MarketColors.warnBg, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 8 },
  permText: { ...Typography.labelSm, color: MarketColors.warnText, flex: 1 },
  permAction: { ...Typography.labelSm, color: MarketColors.brand, fontWeight: '700' },
  railWrap: { paddingVertical: Spacing.md, backgroundColor: Colors.background, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, marginTop: -16, ...shadow1 },
  rail: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  railCard: { width: 180, backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.sm, marginRight: Spacing.sm, borderWidth: 1, borderColor: MarketColors.border },
  railThumb: { height: 90, borderRadius: Radius.md, backgroundColor: MarketColors.surfaceAlt },
  railTitle: { ...Typography.labelLg, color: MarketColors.text, marginTop: 6 },
  railPrice: { ...Typography.titleMd, color: MarketColors.brand, marginTop: 2 },
  railMeta: { ...Typography.labelSm, color: MarketColors.muted, marginTop: 2 },
});
