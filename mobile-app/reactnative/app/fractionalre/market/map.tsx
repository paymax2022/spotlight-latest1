import React from 'react';
import { View, Text, NativeModules, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, List } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useOfferings } from '@/features/fractionalre/hooks';
import { formatNaira, formatYield } from '@/features/fractionalre/utils';

// @maplibre/maplibre-react-native crashes at module-init when its native binary is
// absent (Expo Go / JS-only builds). Guard on NativeModules.MLRNModule and lazy-
// require so we can render a fallback instead. Mirrors the realtor/mobility guard.
const MAP_NATIVE_AVAILABLE = !!NativeModules.MLRNModule;

export default function MarketMap() {
  const offerings = useOfferings();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Map view"
        rightSlot={
          <Pressable hitSlop={10} onPress={() => router.replace('/fractionalre/market')}>
            <List size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />

      {!MAP_NATIVE_AVAILABLE ? (
        <View style={styles.fallbackWrap}>
          <StateView
            kind="empty"
            icon="Map"
            title="Map unavailable here"
            message="The interactive map needs a native build. Browse the locations below or switch to the list."
            actionLabel="Back to list"
            onAction={() => router.replace('/fractionalre/market')}
          />
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {(offerings.data ?? []).map((o) => (
              <Pressable key={o.id} style={styles.row} onPress={() => router.push(`/fractionalre/${o.id}` as never)}>
                <MapPin size={18} color={Colors.teal} strokeWidth={2} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{o.title}</Text>
                  <Text style={styles.rowSub}>{o.location} · {formatYield(o.projectedYieldBps)} · {formatNaira(o.unitPriceKobo)}/unit</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : (
        // Native map build present — render a simple placeholder hookpoint.
        // (Full MapLibre wiring deferred; the realtor MapView component can be
        //  dropped in here when this module ships against a native build.)
        <View style={styles.nativeStub}>
          <StateView kind="empty" icon="Map" title="Map ready" message="Native map module detected. Pins render in a native build." />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  fallbackWrap: { flex: 1 },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  rowText: { flex: 1 },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  rowSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  nativeStub: { flex: 1 },
});
