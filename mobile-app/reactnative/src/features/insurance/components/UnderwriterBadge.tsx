import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ShieldCheck, Info } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { InsuranceColors } from '../constants/insurance.constants';
import type { Disclosure } from '../types';

/**
 * Compliance disclosure chip (PRD §5/§18): "Underwritten by <insurer> · via
 * <aggregator>". Shown on every quote, detail and certificate. Surfaced from the
 * provider, never hard-coded. Reused by IM2.
 */
export default function UnderwriterBadge({
  disclosure,
  onPress,
  compact,
}: {
  disclosure: Disclosure;
  onPress?: () => void;
  compact?: boolean;
}) {
  const Wrapper: any = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Underwritten by ${disclosure.underwriter} via ${disclosure.aggregator}`}
      style={[styles.row, compact && styles.compact]}
    >
      <ShieldCheck size={compact ? 14 : 16} color={InsuranceColors.ok} strokeWidth={2.2} />
      <Text style={[styles.text, compact && styles.textCompact]} numberOfLines={compact ? 1 : 2}>
        Underwritten by <Text style={styles.strong}>{disclosure.underwriter}</Text> · via{' '}
        <Text style={styles.strong}>{disclosure.aggregator}</Text>
      </Text>
      {onPress ? <Info size={14} color={InsuranceColors.muted} /> : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: InsuranceColors.okBg,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  compact: { backgroundColor: 'transparent', paddingVertical: 2, paddingHorizontal: 0 },
  text: { ...Typography.labelSm, color: InsuranceColors.text, flex: 1, lineHeight: 16 },
  textCompact: { ...Typography.caption, color: InsuranceColors.muted },
  strong: { fontWeight: '700' as const, color: InsuranceColors.text },
});
