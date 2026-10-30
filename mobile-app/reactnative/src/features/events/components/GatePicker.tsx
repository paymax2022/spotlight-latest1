import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import TextInputField from '@/components/TextInputField';
import { EventColors } from '@/features/events/constants/events.constants';
import { PRESET_GATES, MAX_GATE_NAME_LEN, normaliseGateName } from '@/features/events/gates';

interface Props {
  value: string;
  onChange: (name: string) => void;
}

// Preset gate chips plus a free-text "Other" gate. The caller owns the value and
// decides where to remember it.
export default function GatePicker({ value, onChange }: Props) {
  const isPreset = (PRESET_GATES as readonly string[]).includes(value);
  const [custom, setCustom] = useState(isPreset ? '' : value);
  const [editing, setEditing] = useState(!isPreset);

  const pickPreset = (name: string) => { setEditing(false); onChange(name); };
  const onCustom = (text: string) => {
    setCustom(text);
    const clean = normaliseGateName(text);
    if (clean) onChange(clean);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Gate</Text>
      <View style={styles.chips}>
        {PRESET_GATES.map((g) => {
          const active = !editing && value === g;
          return (
            <Pressable key={g} onPress={() => pickPreset(g)} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{g}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => { setEditing(true); if (normaliseGateName(custom)) onChange(normaliseGateName(custom)); }} style={[styles.chip, editing && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: editing }}>
          <Text style={[styles.chipText, editing && styles.chipTextActive]}>{editing && normaliseGateName(custom) ? normaliseGateName(custom) : 'Other…'}</Text>
        </Pressable>
      </View>
      {editing ? (
        <TextInputField placeholder="Gate name, e.g. North door" value={custom} onChangeText={onCustom} maxLength={MAX_GATE_NAME_LEN} autoCapitalize="words" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  chipActive: { backgroundColor: EventColors.brand, borderColor: EventColors.brand },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary },
});
