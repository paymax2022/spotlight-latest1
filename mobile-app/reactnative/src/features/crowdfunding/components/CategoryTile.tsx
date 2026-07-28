import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { CampaignCategory } from '../types/crowdfunding.types';

interface Props {
  category: CampaignCategory;
  onPress: () => void;
  /** grid = square tile w/ count; chip = horizontal pill for filter rows. */
  variant?: 'grid' | 'chip';
  active?: boolean;
}

const TINT: Record<CampaignCategory['tint'], { fg: string; bg: string }> = {
  purple: { fg: Colors.primary,           bg: Colors.iconBgPurple },
  blue:   { fg: Colors.secondary,         bg: Colors.iconBgBlue },
  teal:   { fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  orange: { fg: '#B65A00',                bg: Colors.iconBgOrange },
  green:  { fg: '#0F7A37',                bg: Colors.iconBgGreen },
  red:    { fg: Colors.error,             bg: Colors.iconBgRed },
};

export default function CategoryTile({ category, onPress, variant = 'grid', active }: Props) {
  const tint = TINT[category.tint];
  const Icon =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[category.icon] ?? Icons.Folder;

  if (variant === 'chip') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={[styles.chip, active && { backgroundColor: tint.fg, borderColor: tint.fg }]}
      >
        <Icon size={15} color={active ? Colors.onPrimary : tint.fg} strokeWidth={2} />
        <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{category.label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${category.label}, ${category.campaignCount} campaigns`}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: tint.bg }]}>
        <Icon size={22} color={tint.fg} strokeWidth={2} />
      </View>
      <Text style={styles.label} numberOfLines={1}>{category.label}</Text>
      <Text style={styles.count}>{category.campaignCount.toLocaleString('en-NG')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', width: 76, gap: 6 },
  pressed: { opacity: 0.7 },
  iconBox: { width: 56, height: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  count: { ...Typography.caption, color: Colors.onSurfaceVariant },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1, borderColor: Colors.outlineVariant,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
  },
  chipLabel: { ...Typography.labelSm, color: Colors.onSurface },
  chipLabelActive: { color: Colors.onPrimary },
});
