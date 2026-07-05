import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Pencil } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { Place } from '../types/mobility.types';

interface Props {
  pickup: Place;
  dest: Place;
  compact?: boolean;
  /** When provided, the pickup row becomes tappable (edit affordance shown). */
  onEditPickup?: () => void;
  /** When provided, the destination row becomes tappable (edit affordance shown). */
  onEditDest?: () => void;
}

/** One stop line. Prefers the resolved street address; falls back to the label
 *  ("Current location") only when no address is available. Becomes a Pressable
 *  with a pencil when an edit handler is supplied. */
function Stop({ label, place, onEdit }: { label: string; place: Place; onEdit?: () => void }) {
  const text = place.address || place.label;
  const body = (
    <View style={[styles.stop, onEdit && styles.stopFlex]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.address} numberOfLines={1}>{text}</Text>
    </View>
  );
  if (!onEdit) return body;
  return (
    <Pressable
      style={styles.stopEditable}
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${label.toLowerCase()}`}
    >
      {body}
      <Pencil size={15} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

/** Pickup → destination summary with a connector rail (used across estimate,
 *  trip, and driver request screens). Pass onEditPickup / onEditDest to make
 *  either stop editable inline. */
export default function TripRouteCard({ pickup, dest, compact, onEditPickup, onEditDest }: Props) {
  return (
    <View style={[styles.card, compact && styles.compact]}>
      <View style={styles.rail}>
        <View style={styles.dotStart} />
        <View style={styles.line} />
        <View style={styles.dotEnd} />
      </View>
      <View style={styles.stops}>
        <Stop label="PICKUP" place={pickup} onEdit={onEditPickup} />
        <View style={styles.spacer} />
        <Stop label="DESTINATION" place={dest} onEdit={onEditDest} />
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
  stopFlex: { flex: 1 },
  stopEditable: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  spacer: { height: Spacing.md },
  label: { ...Typography.caption, color: Colors.onSurfaceVariant, letterSpacing: 1 },
  address: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
});
