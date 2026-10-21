// Delivery / Pickup / Reserve dine-in selector (FOOD-UAT-D-007).
// Controlled + standalone: restaurant/[id].tsx wires it in a Wave-8 follow-up
// (it owns that file this wave). Dine-in is hidden unless `dineInEnabled`.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { availableChoices, CHOICE_LABEL, type FulfilmentChoice } from '../orderType';

interface Props {
  value: FulfilmentChoice;
  onChange: (next: FulfilmentChoice) => void;
  /** Restaurant flag (`dine_in_enabled`, not yet on the API — caller may pass false). */
  dineInEnabled?: boolean;
}

export default function OrderTypeSelector({ value, onChange, dineInEnabled }: Props) {
  const choices = availableChoices({ dineInEnabled });
  return (
    <View style={s.row} accessibilityRole="radiogroup">
      {choices.map((c) => {
        const active = c === value;
        return (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            testID={`order-type-${c}`}
            style={[s.chip, active && s.chipActive]}
          >
            <Text style={[s.label, active && s.labelActive]}>{CHOICE_LABEL[c]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, paddingHorizontal: Spacing.xs, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  chipActive: { backgroundColor: Colors.primary },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  labelActive: { color: Colors.white },
});
