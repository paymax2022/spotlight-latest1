import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * A selectable option row used across the questionnaire and any single-choice
 * onboarding step. Shows a radio-style tick when selected.
 */
export default function ChoiceCard({ label, description, selected, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.card, selected && styles.cardSelected]}
    >
      <View style={styles.textWrap}>
        <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <View style={[styles.tick, selected && styles.tickSelected]}>
        {selected ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  cardSelected: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  textWrap: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  labelSelected: { color: Colors.primary },
  description: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  tick: {
    width: 24, height: 24, borderRadius: Radius.full,
    borderWidth: 2, borderColor: Colors.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  tickSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
