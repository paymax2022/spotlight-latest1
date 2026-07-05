import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapPin, Navigation } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Pin {
  id: string;
  label: string;
  /** 0..1 normalised position within the map frame. */
  x: number;
  y: number;
  active?: boolean;
}

/**
 * Lightweight static "map" surface used for find-a-vet, home-visit tracking and
 * provider home-nav. Avoids a native map dependency in this FE phase while
 * giving a spatial sense of pins. Pins are positioned by normalised x/y.
 */
export default function VetMapView({
  pins,
  height = 180,
  caption,
}: {
  pins: Pin[];
  height?: number;
  caption?: string;
}) {
  return (
    <View style={[styles.map, { height }]} accessibilityLabel="Map view">
      <View style={[styles.grid, { top: '33%' }]} />
      <View style={[styles.grid, { top: '66%' }]} />
      <View style={[styles.gridV, { left: '33%' }]} />
      <View style={[styles.gridV, { left: '66%' }]} />

      {pins.map((p) => (
        <View key={p.id} style={[styles.pin, { left: `${p.x * 100}%`, top: `${p.y * 100}%` }]}>
          <View style={[styles.pinDot, p.active && styles.pinDotActive]}>
            {p.active ? (
              <Navigation size={14} color={Colors.white} strokeWidth={2.5} />
            ) : (
              <MapPin size={14} color={Colors.white} strokeWidth={2.5} />
            )}
          </View>
          <Text style={styles.pinLabel} numberOfLines={1}>
            {p.label}
          </Text>
        </View>
      ))}

      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    overflow: 'hidden',
  },
  grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: Colors.surfaceContainerHigh },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: Colors.surfaceContainerHigh },
  pin: { position: 'absolute', alignItems: 'center', transform: [{ translateX: -16 }, { translateY: -16 }] },
  pinDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDotActive: { backgroundColor: Colors.primary },
  pinLabel: {
    ...Typography.caption,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLowest,
    paddingHorizontal: 4,
    borderRadius: Radius.sm,
    marginTop: 2,
    maxWidth: 90,
  },
  caption: {
    position: 'absolute',
    bottom: Spacing.sm,
    left: Spacing.sm,
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    backgroundColor: Colors.surfaceContainerLowest,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
});
