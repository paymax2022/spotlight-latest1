import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Icons from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { InsuranceColors, formatNaira, CADENCE_SUFFIX } from '../constants/insurance.constants';
import type { InsuranceProduct } from '../types';
import UnderwriterBadge from './UnderwriterBadge';

/** Catalog product card (browse + hub). Discloses underwriter per compliance. */
export default function ProductCard({
  product,
  onPress,
}: {
  product: InsuranceProduct;
  onPress: () => void;
}) {
  const Icon =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[product.icon] ?? Icons.ShieldCheck;
  const tint = product.provider === 'OCTAMILE' ? InsuranceColors.octamile : InsuranceColors.mycover;
  const tintBg = product.provider === 'OCTAMILE' ? InsuranceColors.octamileBg : InsuranceColors.mycoverBg;
  const suffix = CADENCE_SUFFIX[product.premiumCadence] ?? '';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.displayName}, from ${formatNaira(product.fromPremiumKobo)}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconBox, { backgroundColor: tintBg }]}>
          <Icon size={22} color={tint} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{product.displayName}</Text>
          <Text style={styles.desc} numberOfLines={2}>{product.shortDescription}</Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>

      <UnderwriterBadge disclosure={product.disclosure} compact />

      <View style={styles.priceRow}>
        <Text style={styles.fromLabel}>from</Text>
        <Text style={styles.price}>{formatNaira(product.fromPremiumKobo)}<Text style={styles.cadence}>{suffix}</Text></Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  pressed: { opacity: 0.9 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  desc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs },
  fromLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  price: { ...Typography.titleMd, color: InsuranceColors.brand },
  cadence: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '500' as const },
});
