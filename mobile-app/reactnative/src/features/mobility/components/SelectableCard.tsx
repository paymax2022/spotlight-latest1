import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  title: string;
  subtitle?: string;
  icon?: string;          // lucide name
  trailing?: string;      // e.g. a price (server value)
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * Shared single-select option card used across the mode wizards (category /
 * size / speed / service / vehicle-class / truck-size / hire-type). Mirrors the
 * ServiceTypeCard look so every mode's selectors are visually consistent.
 */
export default function SelectableCard({ title, subtitle, icon, trailing, selected, disabled, onPress }: Props) {
  const Icon = icon ? ((Icons as unknown as Record<string, Icons.LucideIcon>)[icon] ?? Icons.Circle) : null;
  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected, disabled && styles.cardDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
    >
      {Icon && (
        <View style={[styles.iconBox, selected && styles.iconBoxSelected]}>
          <Icon size={20} color={selected ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, selected && styles.titleSelected]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? <Text style={[styles.trailing, selected && styles.trailingSelected]}>{trailing}</Text> : null}
      {selected && (
        <View style={styles.checkWrap}>
          <Check size={16} color={Colors.primary} strokeWidth={2.6} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
  },
  cardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  cardDisabled: { opacity: 0.5 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  iconBoxSelected: { backgroundColor: Colors.surfaceContainerLowest },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  titleSelected: { color: Colors.primary },
  subtitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  trailing: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  trailingSelected: { color: Colors.primary },
  checkWrap: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
});
