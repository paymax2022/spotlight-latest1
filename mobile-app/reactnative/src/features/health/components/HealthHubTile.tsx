import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { VERTICAL_META } from '../constants/health.constants';
import type { Vertical } from '../types';

/**
 * Care-loop entry tile (HEALTH-BUILD §1) for the health hub. Glass-style white
 * card with a soft-tinted icon enclosure, per DESIGN-Mobile.md iconography.
 */
export default function HealthHubTile({
  vertical,
  onPress,
}: {
  vertical: Vertical;
  onPress: () => void;
}) {
  const meta = VERTICAL_META[vertical];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.Activity;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={meta.label}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: meta.iconBg }]}>
        <Icon size={24} color={meta.color} strokeWidth={2} />
      </View>
      <Text style={styles.label}>{meta.label}</Text>
      <Text style={styles.tagline} numberOfLines={2}>
        {meta.tagline}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    minHeight: 132,
  },
  pressed: { opacity: 0.9 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...Typography.titleMd, color: Colors.onSurface },
  tagline: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 16 },
});
