// ── Insurance (live) — category tile ────────────────────────────────────────
// Seven tiles for the seven real MyCover categories. The count is passed in from
// the live catalog, never hardcoded — if the aggregator retires a product the
// tile says so instead of promising cover that no longer exists.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Icons from 'lucide-react-native';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { InsuranceColors } from '../../constants/insurance.constants';
import type { CategoryMeta } from '../../live/catalog';
import { toneTokens } from './tone';

export default function CategoryTile({
  meta,
  count,
  onPress,
}: {
  meta: CategoryMeta;
  /** null while the catalog is still loading — the tile shows no number. */
  count: number | null;
  onPress: () => void;
}) {
  const tone = toneTokens(meta.tone);
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? ShieldCheck;
  const unavailable = count === 0;

  return (
    <Pressable
      onPress={onPress}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityLabel={
        count == null
          ? meta.label
          : `${meta.label}, ${count} ${count === 1 ? 'product' : 'products'}`
      }
      style={({ pressed }) => [styles.tile, pressed && styles.pressed, unavailable && styles.dim]}
    >
      <View style={[styles.icon, { backgroundColor: tone.bg }]}>
        <Icon size={22} color={tone.fg} strokeWidth={2} />
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {meta.label}
      </Text>
      <Text style={styles.blurb} numberOfLines={2}>
        {meta.blurb}
      </Text>
      {count == null ? null : (
        <Text style={[styles.count, { color: tone.fg }]}>
          {unavailable ? 'None right now' : `${count} ${count === 1 ? 'plan' : 'plans'}`}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
    gap: 2,
  },
  pressed: { opacity: 0.9 },
  dim: { opacity: 0.55 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  blurb: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 17 },
  count: { ...Typography.labelSm, fontWeight: '700' as const, marginTop: Spacing.xs },
});
