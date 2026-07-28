import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  /** Optional override copy; defaults to the canonical non-cash disclosure. */
  message?: string;
  compact?: boolean;
}

/**
 * Non-cash disclosure banner (SAFETY INVARIANT §6.5 "two-currency clarity").
 * Rendered on EVERY gamification surface so XP/coins are never mistaken for
 * withdrawable money. They never silently convert to Naira.
 */
export default function GameNonCashNotice({ message, compact }: Props) {
  return (
    <View style={[styles.box, compact && styles.compact]} accessibilityRole="text">
      <Info size={15} color={Colors.secondary} strokeWidth={2.2} />
      <Text style={styles.text}>
        {message ??
          'XP and coins are rewards for activity — they are not cash, cannot be withdrawn, and never convert to Naira.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgBlue,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  compact: { padding: Spacing.sm },
  text: { ...Typography.caption, color: Colors.onSurface, flex: 1, lineHeight: 17 },
});
