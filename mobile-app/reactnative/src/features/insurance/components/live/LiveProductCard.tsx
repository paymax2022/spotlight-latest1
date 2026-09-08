// ── Insurance (live) — catalog product card ─────────────────────────────────
// One row of the real MyCover catalog: what it covers, who carries the risk,
// how long the cover runs, and what it costs — with flat and percentage pricing
// rendered differently (see PriceLabel).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Icons from 'lucide-react-native';
import { CalendarDays, ChevronRight, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { InsuranceColors } from '../../constants/insurance.constants';
import { categoryMeta } from '../../live/catalog';
import { stripTags } from '../../live/html';
import { coverPeriodLabel, nairaCompact } from '../../live/money';
import type { Product } from '../../live/types';
import PriceLabel, { PricingModeBadge } from './PriceLabel';
import UnderwriterMark from './UnderwriterMark';
import { toneTokens } from './tone';

export default function LiveProductCard({
  product,
  onPress,
}: {
  product: Product;
  onPress: () => void;
}) {
  const meta = categoryMeta(product.productLine);
  const tone = toneTokens(meta.tone);
  const Icon =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? ShieldCheck;
  const blurb = stripTags(product.description) || meta.blurb;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, underwritten by ${product.underwriter}`}
      style={({ pressed }) => [
        styles.card,
        pressed && styles.pressed,
        !product.purchasable && styles.cardClosed,
      ]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconBox, { backgroundColor: tone.bg }]}>
          <Icon size={22} color={tone.fg} strokeWidth={2} />
        </View>
        <View style={styles.grow}>
          <Text style={styles.title} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={styles.desc} numberOfLines={2}>
            {blurb}
          </Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>

      <View style={styles.metaRow}>
        <UnderwriterMark
          underwriter={product.underwriter}
          logoUrl={product.underwriterLogoUrl}
          size={22}
        />
        <Text style={styles.underwriter} numberOfLines={1}>
          {product.underwriter}
        </Text>
        {product.coverPeriodDays > 0 ? (
          <>
            <CalendarDays size={13} color={Colors.onSurfaceVariant} />
            <Text style={styles.period}>{coverPeriodLabel(product.coverPeriodDays)}</Text>
          </>
        ) : null}
      </View>

      <View style={styles.divider} />

      <View style={styles.priceRow}>
        <PriceLabel product={product} />
        <View style={styles.grow} />
        {!product.purchasable ? (
          <Text style={styles.unavailable}>Not available</Text>
        ) : product.sumInsuredKobo > 0 ? (
          <Text style={styles.sumInsured}>
            up to {nairaCompact(product.sumInsuredKobo)}
          </Text>
        ) : (
          <PricingModeBadge product={product} />
        )}
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
  // Listed but not currently issuable by the insurer — visible, visibly muted.
  cardClosed: { opacity: 0.62 },
  grow: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  desc: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2, lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  underwriter: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flexShrink: 1, marginRight: Spacing.xs },
  period: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: InsuranceColors.border },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sumInsured: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  unavailable: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
});
