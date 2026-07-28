import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

/**
 * "Nutrition-Verified" badge — granted when a vendor confirms a dish's profile.
 * A small (`compact`) variant fits inside dish rows; the default sits on cards.
 */
export default function NutritionBadge({ compact }: { compact?: boolean }) {
  return (
    <View style={[styles.badge, compact && styles.compact]}>
      <BadgeCheck size={compact ? 12 : 14} color={Colors.tertiaryContainer} strokeWidth={2.4} />
      <Text style={[styles.text, compact && styles.textCompact]}>Nutrition-Verified</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
  },
  compact: { paddingHorizontal: 6, paddingVertical: 2 },
  text: { ...Typography.labelSm, color: Colors.tertiaryContainer },
  textCompact: { ...Typography.caption, color: Colors.tertiaryContainer },
});
