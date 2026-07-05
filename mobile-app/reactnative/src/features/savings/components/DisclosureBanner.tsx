import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { SavingsColors } from '../constants/savings.constants';

interface Props {
  text: string;
  tone?: 'info' | 'warn';
}

/** Compliance disclosure banner (NL-2 no-yield, NL-7 Ajo peer rotation). */
export default function DisclosureBanner({ text, tone = 'info' }: Props) {
  const warn = tone === 'warn';
  return (
    <View style={[styles.wrap, { backgroundColor: warn ? SavingsColors.warnBg : SavingsColors.okBg }]}>
      <Info size={16} color={warn ? SavingsColors.warnText : SavingsColors.ok} strokeWidth={2} />
      <Text style={[styles.text, { color: warn ? SavingsColors.warnText : SavingsColors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  text: { ...Typography.bodySm, flex: 1 },
});
