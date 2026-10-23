import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, Typography } from '@/constants/tokens';
import type { TaxonomyCategory, CuisineRef } from '../types';
import DynamicIcon from './DynamicIcon';

export interface TaxonomyData {
  categories: TaxonomyCategory[];
  cuisines: CuisineRef[];
}

interface Props {
  /** null when the backend flag is off or the call failed: renders nothing. */
  taxonomy: TaxonomyData | null;
  cuisineIds: string[];
  categoryIds: string[];
  onChange: (next: { cuisineIds: string[]; categoryIds: string[] }) => void;
}

/**
 * Two horizontal chip rows (cuisine, category), single-select per row,
 * "All" first. Selection is expressed as id arrays so it maps straight onto
 * the discovery query's cuisineIds/categoryIds.
 */
export default function TaxonomyFilters({ taxonomy, cuisineIds, categoryIds, onChange }: Props) {
  if (!taxonomy) return null;
  const cuisines = taxonomy.cuisines ?? [];
  const categories = taxonomy.categories ?? [];
  if (cuisines.length === 0 && categories.length === 0) return null;

  const selCuisine = cuisineIds[0] ?? null;
  const selCategory = categoryIds[0] ?? null;

  return (
    <View>
      {cuisines.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsContent}>
          <Chip label="All cuisines" active={selCuisine === null} onPress={() => onChange({ cuisineIds: [], categoryIds })} />
          {cuisines.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              active={selCuisine === c.id}
              onPress={() => onChange({ cuisineIds: [c.id], categoryIds })}
            />
          ))}
        </ScrollView>
      ) : null}
      {categories.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsContent}>
          <Chip label="All categories" active={selCategory === null} onPress={() => onChange({ cuisineIds, categoryIds: [] })} />
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              icon={c.icon}
              active={selCategory === c.id}
              onPress={() => onChange({ cuisineIds, categoryIds: [c.id] })}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Chip({ label, icon, active, onPress }: { label: string; icon?: string | null; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Filter: ${label}`}
      style={({ pressed }) => [s.chip, active && s.chipActive, pressed && { opacity: 0.9 }]}
    >
      {icon ? <DynamicIcon name={icon} color={active ? Colors.white : Colors.onSurfaceVariant} size={15} strokeWidth={2} /> : null}
      <Text style={[s.chipLabel, active && s.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  chips: { flexGrow: 0, marginTop: Spacing.md },
  chipsContent: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipLabelActive: { color: Colors.white },
});
