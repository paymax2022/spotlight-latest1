import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { ConnectColors } from '../constants/connect.constants';

interface Props {
  items: string[];
  selected?: string[];
  onToggle?: (value: string) => void;
  variant?: 'static' | 'selectable';
}

/**
 * Tag / interest / skill chip row, shared across discovery, networking and
 * profile screens. `selectable` drives filter & edit surfaces; `static` is the
 * read-only interest list on a profile card.
 */
export default function DiscoveryChipRow({ items, selected = [], onToggle, variant = 'static' }: Props) {
  return (
    <View style={styles.row}>
      {items.map((item) => {
        const active = selected.includes(item);
        const selectable = variant === 'selectable';
        return (
          <Pressable
            key={item}
            disabled={!selectable}
            onPress={() => onToggle?.(item)}
            style={[styles.chip, selectable && styles.chipSelectable, active && styles.chipActive]}
            accessibilityRole={selectable ? 'button' : undefined}
            accessibilityState={selectable ? { selected: active } : undefined}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    backgroundColor: Colors.surfaceContainerLow,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipSelectable: { backgroundColor: Colors.surfaceContainerLowest },
  chipActive: { backgroundColor: Colors.iconBgPurple, borderColor: ConnectColors.brand },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipTextActive: { color: ConnectColors.brand, fontWeight: '700' },
});
