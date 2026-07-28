import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

/**
 * Financial-solicitation guard copy (PRD §6.4 / SAFETY INVARIANTS). Surfaced on
 * every gifting surface: gifts are voluntary and must never be demanded.
 */
export default function SolicitationGuard() {
  return (
    <View style={styles.card}>
      <ShieldAlert size={16} color={Colors.gold} strokeWidth={2} />
      <Text style={styles.text}>
        Gifts are voluntary. Never send money to someone who asks or pressures you for it —
        demanding gifts violates our guidelines. Report anyone who solicits funds.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  text: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
});
