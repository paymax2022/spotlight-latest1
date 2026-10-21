// Dine-in reservation inputs: party size + optional table preference.
// The restaurant assigns/confirms the actual table on accept.
import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { validateDineIn, MAX_PARTY_SIZE, MAX_TABLE_LEN, type DineInInput } from '../orderType';

interface Props {
  value: DineInInput;
  onChange: (next: DineInInput) => void;
}

export default function DineInReserveSheet({ value, onChange }: Props) {
  const error = validateDineIn(value);
  const step = (d: number) =>
    onChange({ ...value, partySize: Math.min(MAX_PARTY_SIZE, Math.max(1, value.partySize + d)) });
  return (
    <View style={s.wrap}>
      <Text style={s.title}>Party size</Text>
      <View style={s.stepper}>
        <Pressable onPress={() => step(-1)} accessibilityLabel="Fewer guests" style={s.stepBtn} testID="party-minus"><Text style={s.stepTxt}>−</Text></Pressable>
        <Text style={s.size} testID="party-size">{value.partySize}</Text>
        <Pressable onPress={() => step(1)} accessibilityLabel="More guests" style={s.stepBtn} testID="party-plus"><Text style={s.stepTxt}>+</Text></Pressable>
      </View>
      <Text style={s.title}>Table preference (optional)</Text>
      <TextInput
        value={value.tablePreference ?? ''}
        onChangeText={(t) => onChange({ ...value, tablePreference: t })}
        placeholder="e.g. by the window, patio"
        maxLength={MAX_TABLE_LEN}
        style={s.input}
        placeholderTextColor={Colors.onSurfaceVariant}
      />
      <Text style={s.hint}>The restaurant confirms your table when they accept the reservation.</Text>
      {error ? <Text style={s.err}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  stepBtn: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { ...Typography.titleLg, color: Colors.primary },
  size: { ...Typography.headlineMd, color: Colors.onSurface, minWidth: 32, textAlign: 'center' },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderRadius: Radius.lg, padding: Spacing.sm },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  err: { ...Typography.labelSm, color: Colors.error },
});
