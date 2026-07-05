// ── Paymax · Admin — ReasonPrompt ────────────────────────────────────────────
// A small inline reason capture (reuses the shared TextInputField) shown before
// a privileged action (KYC reject, withdrawal reject, approval reject). Controlled.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Spacing } from '@/constants/spacing';
import TextInputField from '@/components/TextInputField';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  error?: string;
}

export default function ReasonPrompt({
  value,
  onChangeText,
  label = 'Reason',
  placeholder = 'Add a reason for the audit log…',
  error,
}: Props) {
  return (
    <View style={styles.wrap}>
      <TextInputField
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        error={error}
        multiline
        numberOfLines={3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.sm },
});
