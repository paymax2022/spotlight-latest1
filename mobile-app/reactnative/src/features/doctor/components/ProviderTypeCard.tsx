import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  label:       string;
  description: string;
  icon:        LucideIcon;
  selected:    boolean;
  onPress:     () => void;
  disabled?:   boolean;
}

// New component (Section A · entry 4): a selectable card for the provider-type
// choice list. Existing rows (ProfileMenuItem / AlertCard) are navigation/CTA
// affordances without a selected-state tick; this is a radio-style selectable
// surface, so it is genuinely new. Prop named `selected` (never `ref`).
export default function ProviderTypeCard({ label, description, icon: Icon, selected, onPress, disabled }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.card, selected && styles.cardSelected, disabled && styles.cardDisabled]}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={label}
    >
      <View style={[styles.iconBox, { backgroundColor: selected ? Colors.iconBgPurple : Colors.surfaceContainerLow }]}>
        <Icon size={22} color={selected ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
        <Text style={styles.description} numberOfLines={2}>{description}</Text>
      </View>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest, marginBottom: Spacing.sm },
  cardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  cardDisabled: { opacity: 0.5 },
  iconBox:      { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body:         { flex: 1, gap: 2 },
  label:        { ...Typography.labelLg, color: Colors.onSurface },
  description:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  check:        { width: 24, height: 24, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkOn:      { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
