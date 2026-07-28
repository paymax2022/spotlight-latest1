import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { VOLATILITY_DISCLOSURE } from '../constants/crypto.constants';

interface Props {
  message?: string;
  compact?: boolean;
}

/**
 * Risk-education card shown before/around every crypto trade (education-first;
 * docs/crypto/product.md). Uses the gold/warning tint so it reads as caution,
 * not error.
 */
export default function VolatilityWarning({ message = VOLATILITY_DISCLOSURE, compact }: Props) {
  return (
    <View style={[styles.card, compact && styles.compact]}>
      <View style={styles.iconBox}>
        <TriangleAlert size={16} color={Colors.onWarning} strokeWidth={2} />
      </View>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.iconBgGold,
    padding: Spacing.md,
  },
  compact: { padding: Spacing.sm },
  iconBox: { marginTop: 1 },
  text: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
});
