import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check, BadgeCheck, Star, MapPin, Truck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { Pharmacy } from '@/types/doctor.batch3';

interface Props {
  pharmacy: Pharmacy;
  selected: boolean;
  onSelect: (pharmacy: Pharmacy) => void;
}

// New component: a selectable pharmacy directory row (verified badge, rating,
// distance, same-day delivery, stock flag, preferred marker + selection tick).
// No existing row composes the directory metadata, so this is genuinely new.
export default function PharmacyRow({ pharmacy, selected, onSelect }: Props) {
  return (
    <Pressable
      style={[styles.row, selected && styles.rowSelected]}
      onPress={() => onSelect(pharmacy)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={pharmacy.name}
    >
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{pharmacy.name}</Text>
          {pharmacy.verified && <BadgeCheck size={16} color={Colors.secondary} strokeWidth={2.2} />}
          {pharmacy.isPreferred && (
            <View style={styles.preferredChip}>
              <Text style={styles.preferredText}>Preferred</Text>
            </View>
          )}
        </View>
        <Text style={styles.address} numberOfLines={1}>{pharmacy.address}</Text>
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Star size={12} color={Colors.secondary} strokeWidth={2.2} />
            <Text style={styles.metaText}>{pharmacy.rating.toFixed(1)}</Text>
          </View>
          <View style={styles.metaItem}>
            <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
            <Text style={styles.metaText}>{pharmacy.distanceKm.toFixed(1)} km</Text>
          </View>
          {pharmacy.deliversToday && (
            <View style={styles.metaItem}>
              <Truck size={12} color={Colors.teal} strokeWidth={2.2} />
              <Text style={styles.metaText}>Same-day</Text>
            </View>
          )}
          <Text style={[styles.stockText, pharmacy.hasStock ? styles.stockOk : styles.stockNo]}>
            {pharmacy.hasStock ? 'In stock' : 'No stock'}
          </Text>
        </View>
      </View>
      <View style={[styles.tick, selected && styles.tickOn]}>
        {selected && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:           { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  rowSelected:   { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  body:          { flex: 1, gap: 3 },
  titleRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  name:          { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  preferredChip: { height: 20, paddingHorizontal: 8, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  preferredText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  address:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  metaRow:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 2 },
  metaItem:      { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText:      { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  stockText:     { ...Typography.labelSm, fontWeight: '700' },
  stockOk:       { color: Colors.teal },
  stockNo:       { color: Colors.error },
  tick:          { width: 24, height: 24, borderRadius: Radius.sm + 2, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  tickOn:        { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
