import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Icons from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { InsuranceColors, formatNaira } from '../constants/insurance.constants';
import type { Policy } from '../types';
import StateChip from './StateChip';
import UnderwriterBadge from './UnderwriterBadge';

/** Policy wallet card (list + summaries). Reused by IM2. */
export default function PolicyCard({
  policy,
  onPress,
}: {
  policy: Policy;
  onPress: () => void;
}) {
  const Icon =
    (Icons as unknown as Record<string, Icons.LucideIcon>)[policy.icon] ?? Icons.ShieldCheck;
  const tint = policy.provider === 'OCTAMILE' ? InsuranceColors.octamile : InsuranceColors.mycover;
  const tintBg = policy.provider === 'OCTAMILE' ? InsuranceColors.octamileBg : InsuranceColors.mycoverBg;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${policy.productName} policy, ${policy.state}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconBox, { backgroundColor: tintBg }]}>
          <Icon size={22} color={tint} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{policy.productName}</Text>
          <Text style={styles.sub}>Cover {formatNaira(policy.sumInsuredKobo)}</Text>
        </View>
        <ChevronRight size={20} color={Colors.onSurfaceVariant} />
      </View>

      <View style={styles.metaRow}>
        <StateChip state={policy.state} />
        <Text style={styles.premium}>{formatNaira(policy.premiumKobo)}<Text style={styles.cadence}> {cadence(policy)}</Text></Text>
      </View>

      <UnderwriterBadge disclosure={policy.disclosure} compact />
    </Pressable>
  );
}

function cadence(p: Policy): string {
  switch (p.premiumCadence) {
    case 'monthly': return '/ mo';
    case 'annual': return '/ yr';
    case 'per-shipment': return '/ shipment';
    case 'per-trip': return '/ trip';
    default: return '';
  }
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
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  premium: { ...Typography.labelLg, color: InsuranceColors.text },
  cadence: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '500' as const },
});
