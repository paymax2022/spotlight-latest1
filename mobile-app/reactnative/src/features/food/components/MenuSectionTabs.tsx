import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, Typography } from '@/constants/tokens';
import type { MenuSection } from '../types';

interface Props {
  sections: MenuSection[];
  /** Index of the section currently in view. */
  activeIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Pinned horizontal tab bar for the store page menu. Hidden when there is one
 * section or fewer; empty sections never render a tab. Chip styling mirrors
 * TaxonomyFilters on /food.
 */
export default function MenuSectionTabs({ sections, activeIndex, onSelect }: Props) {
  if (sections.length <= 1) return null;
  return (
    <View style={s.bar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.content}
        accessibilityRole="tablist"
      >
        {sections.map((sec, i) => {
          if (sec.items.length === 0) return null;
          const active = i === activeIndex;
          return (
            <Pressable
              key={sec.id ?? `idx-${i}`}
              onPress={() => onSelect(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Menu section: ${sec.name}`}
              style={({ pressed }) => [s.chip, active && s.chipActive, pressed && { opacity: 0.9 }]}
            >
              <Text style={[s.label, active && s.labelActive]}>{sec.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    backgroundColor: Colors.background,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
  },
  content: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  labelActive: { color: Colors.white },
});
