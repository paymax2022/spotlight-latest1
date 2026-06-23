import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { Place } from '../types/mobility.types';

interface Props {
  pickup: Place;
  dest: Place;
  compact?: boolean;
}

/** Pickup → destination summary with a connector rail (used across estimate,
 *  trip, and driver request screens). */
export default function TripRouteCard({ pickup, dest, compact }: Props) {
  return (
    <View style={[styles.card, compact && styles.compact]}>
      <View style={styles.rail}>
        <View style={styles.dotStart} />
        <View style={styles.line} />
        <View style={styles.dotEnd} />
      </View>
      <View style={styles.stops}>
        <View style={styles.stop}>
          <Text style={styles.label}>PICKUP</Text>
          <Text style={styles.address} numberOfLines={1}>{pickup.label ?? pickup.address}</Text>
        </View>
        <View style={styles.spacer} />
        <View style={styles.stop}>
          <Text style={styles.label}>DESTINATION</Text>
          <Text style={styles.address} numberOfLines={1}>{dest.label ?? dest.address}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  compact: { backgroundColor: Colors.transparent, padding: 0 },
  rail: { width: 14, alignItems: 'center', paddingTop: 6 },
  dotStart: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.secondary, borderWidth: 2.5, borderColor: Colors.white },
  line: { width: 2, flex: 1, backgroundColor: Colors.outlineVariant, marginVertical: 4 },
  dotEnd: { width: 12, height: 12, borderRadius: 3, backgroundColor: Colors.primary },
  stops: { flex: 1 },
  stop: { gap: 2 },
  spacer: { height: Spacing.md },
  label: { ...Typography.caption, color: Colors.onSurfaceVariant, letterSpacing: 1 },
  address: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
});
