import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { MapPin, Navigation } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useProperty } from '@/features/stays/hooks';
import { StaysColors } from '@/features/stays/constants/stays.constants';

function distLabel(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

export default function LocationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prop = useProperty(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Location" subtitle={prop.data?.name} />
      {prop.isLoading ? (
        <StateView kind="loading" message="Loading map…" />
      ) : prop.isError || !prop.data ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => prop.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Schematic map */}
          <View style={styles.map}>
            <View style={styles.marker}>
              <MapPin size={28} color={Colors.error} fill={Colors.error} strokeWidth={1.5} />
            </View>
            <Text style={styles.mapCoords}>{prop.data.geo.lat.toFixed(4)}, {prop.data.geo.lng.toFixed(4)}</Text>
          </View>

          <View style={styles.addrRow}>
            <MapPin size={16} color={Colors.onSurfaceVariant} />
            <Text style={styles.addr}>{prop.data.address}</Text>
          </View>

          <Text style={styles.sectionTitle}>What's nearby</Text>
          {prop.data.nearbyLandmarks.map((l) => (
            <View key={l.name} style={styles.nearRow}>
              <View style={styles.nearIcon}><Navigation size={14} color={StaysColors.accent} strokeWidth={2} /></View>
              <Text style={styles.nearName}>{l.name}</Text>
              <Text style={styles.nearDist}>{distLabel(l.distanceM)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  map: { height: 220, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerHigh, borderWidth: 1, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  marker: { alignItems: 'center', justifyContent: 'center' },
  mapCoords: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  addr: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  nearRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  nearIcon: { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  nearName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  nearDist: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
