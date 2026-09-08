// ── Insurance (live) — the price, rendered honestly ─────────────────────────
// 27 of MyCover's 68 products are PERCENTAGE-priced: `base_price` is a RATE, not
// an amount. Rendering "₦0.50" where the product actually costs 0.5% of whatever
// you insure misprices it by orders of magnitude to the reader's eye, which is
// why flat and percentage products get visibly different treatments here rather
// than sharing one money row.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { InsuranceColors } from '../../constants/insurance.constants';
import { priceDisplay } from '../../live/money';
import type { Product } from '../../live/types';

type PriceProduct = Pick<
  Product,
  'basePriceKobo' | 'isPercentage' | 'rateBps' | 'coverPeriodDays' | 'name'
>;

export default function PriceLabel({
  product,
  size = 'md',
}: {
  product: PriceProduct;
  size?: 'sm' | 'md' | 'lg';
}) {
  const price = priceDisplay(product);
  const headlineStyle =
    size === 'lg' ? styles.headlineLg : size === 'sm' ? styles.headlineSm : styles.headlineMd;

  return (
    <View style={styles.row} accessible accessibilityLabel={price.a11y}>
      {price.prefix ? <Text style={styles.prefix}>{price.prefix}</Text> : null}
      <Text style={headlineStyle}>{price.headline}</Text>
      {price.suffix ? (
        <Text style={price.kind === 'percentage' ? styles.suffixWide : styles.suffix}>
          {price.suffix}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A one-word badge that tells the reader HOW this product is priced before they
 * read the number — the difference between a fixed premium and a rate on their
 * own declared value.
 */
export function PricingModeBadge({ product }: { product: Pick<Product, 'isPercentage'> }) {
  const percentage = product.isPercentage;
  return (
    <View style={[styles.badge, percentage ? styles.badgeRate : styles.badgeFlat]}>
      <Text style={[styles.badgeText, percentage ? styles.badgeTextRate : styles.badgeTextFlat]}>
        {percentage ? 'Rate-based' : 'Fixed price'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs, flexShrink: 1 },
  prefix: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headlineSm: { ...Typography.labelLg, color: InsuranceColors.brand },
  headlineMd: { ...Typography.titleMd, color: InsuranceColors.brand },
  headlineLg: { ...Typography.headlineMd, color: InsuranceColors.brand },
  suffix: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  suffixWide: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flexShrink: 1 },

  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  badgeFlat: { backgroundColor: InsuranceColors.okBg },
  badgeRate: { backgroundColor: Colors.iconBgGold },
  badgeText: { ...Typography.labelSm, fontWeight: '600' as const },
  // Dark teal, not InsuranceColors.ok — the light teal fails contrast on its own tint.
  badgeTextFlat: { color: Colors.tertiaryContainer },
  badgeTextRate: { color: InsuranceColors.warnText },
});
