import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { InsuranceColors, formatNaira, CADENCE_SUFFIX } from '../constants/insurance.constants';

/**
 * Label / value row used on quote review, premium summary and policy detail.
 * Pass `amountKobo` for money (rendered via formatNaira) or `value` for text.
 */
export default function PremiumRow({
  label,
  amountKobo,
  value,
  cadence,
  emphasis,
}: {
  label: string;
  amountKobo?: number;
  value?: string;
  cadence?: string;
  emphasis?: boolean;
}) {
  const suffix = cadence ? CADENCE_SUFFIX[cadence] ?? '' : '';
  const display =
    typeof amountKobo === 'number' ? `${formatNaira(amountKobo)}${suffix}` : (value ?? '—');
  return (
    <View style={[styles.row, emphasis && styles.rowEmphasis]}>
      <Text style={[styles.label, emphasis && styles.labelEmphasis]}>{label}</Text>
      <Text style={[styles.value, emphasis && styles.valueEmphasis]}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  rowEmphasis: {
    borderTopWidth: 1,
    borderTopColor: InsuranceColors.border,
    marginTop: Spacing.xs,
    paddingTop: Spacing.md,
  },
  label: { ...Typography.bodyMd, color: InsuranceColors.muted, flex: 1 },
  labelEmphasis: { ...Typography.titleMd, color: InsuranceColors.text },
  value: { ...Typography.labelLg, color: InsuranceColors.text, textAlign: 'right', flexShrink: 0, marginLeft: Spacing.md },
  valueEmphasis: { ...Typography.titleMd, color: InsuranceColors.brand },
});
