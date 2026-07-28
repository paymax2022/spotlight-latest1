import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  label:        string;
  hint?:        string;
  value:        string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}

// New component: a labelled multiline note field. TextInputField is a fixed
// 56px single-line field (no multiline grow / textAlignVertical top), which does
// not fit a SOAP narrative box, so this multiline variant is genuinely new.
export default function SoapSection({ label, hint, value, onChangeText, placeholder }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
      <TextInput
        style={[styles.input, focused && styles.inputFocused]}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={Colors.outline}
        multiline
        textAlignVertical="top"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:      { marginBottom: Spacing.md },
  label:        { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  hint:         { ...Typography.caption, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  input:        { minHeight: 96, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.transparent, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface },
  inputFocused: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
});
