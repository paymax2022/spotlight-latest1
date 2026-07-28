import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatNairaWhole } from '../utils/mobilityFormatters';
import type { ServiceTypeMeta } from '../constants/mobility.constants';
import type { Kobo } from '../types/mobility.types';

interface Props {
  meta: ServiceTypeMeta;
  fareKobo?: Kobo;            // estimated fare for this category (from backend)
  etaMin?: number;
  selected: boolean;
  onPress: () => void;
}

/** Selectable ride-category row used on the estimate / category screen. */
export default function ServiceTypeCard({ meta, fareKobo, etaMin, selected, onPress }: Props) {
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Car;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, selected && styles.cardSelected]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
        <Icon size={24} color={selected ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>{meta.label}</Text>
        <View style={styles.metaRow}>
          <Users size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.meta}>{meta.seats}</Text>
          <Text style={styles.metaDesc} numberOfLines={1}>· {meta.description}</Text>
        </View>
      </View>
      <View style={styles.priceCol}>
        <Text style={styles.price}>{fareKobo != null ? formatNairaWhole(fareKobo) : '—'}</Text>
        {etaMin != null && <Text style={styles.eta}>{etaMin} min away</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  cardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  iconWrap: { width: 46, height: 46, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  iconWrapSelected: { backgroundColor: Colors.surfaceContainerLowest },
  body: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaDesc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flexShrink: 1 },
  priceCol: { alignItems: 'flex-end' },
  price: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  eta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
