import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { RISK_CATEGORY_STYLE } from '../constants/onboarding.constants';
import type { SuitabilityResult } from '../types/onboarding.types';

interface Props {
  result: SuitabilityResult;
}

/**
 * Hero card summarising a scored suitability profile: the risk category badge,
 * a plain-language description and the products the profile is cleared for.
 */
export default function RiskResultCard({ result }: Props) {
  const style = RISK_CATEGORY_STYLE[result.riskCategory];

  return (
    <View style={styles.card}>
      <View style={[styles.badge, { backgroundColor: style.bg }]}>
        <ShieldCheck size={28} color={style.fg} strokeWidth={2} />
      </View>
      <Text style={styles.label}>Your risk profile</Text>
      <Text style={[styles.category, { color: style.fg }]}>{style.label}</Text>
      <Text style={styles.tagline}>{style.tagline}</Text>
      <Text style={styles.description}>{result.summary}</Text>

      <View style={styles.divider} />

      <Text style={styles.productsLabel}>Products you can explore</Text>
      <View style={styles.products}>
        {result.eligibleProducts.map((p) => (
          <View key={p} style={styles.productRow}>
            <View style={styles.productTick}>
              <Check size={12} color={Colors.tertiaryContainer} strokeWidth={3} />
            </View>
            <Text style={styles.productText}>{p}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.lg,
  },
  badge: {
    width: 64, height: 64, borderRadius: Radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.md },
  category: { ...Typography.headlineMd },
  tagline: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.xs },
  description: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  divider: { height: 1, alignSelf: 'stretch', backgroundColor: Colors.surfaceContainerHigh, marginVertical: Spacing.lg },
  productsLabel: { ...Typography.labelMd, color: Colors.onSurface, alignSelf: 'flex-start' },
  products: { alignSelf: 'stretch', marginTop: Spacing.sm, gap: Spacing.sm },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  productTick: {
    width: 20, height: 20, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center',
  },
  productText: { ...Typography.bodyMd, color: Colors.onSurface },
});
