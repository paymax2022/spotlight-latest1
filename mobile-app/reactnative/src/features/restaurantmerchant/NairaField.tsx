import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { CURRENCY_CODE, NAIRA_SYMBOL, sanitizeNairaInput } from './money';

/**
 * A money input for restaurant owners: the naira sign in front, "NGN" behind, and
 * only characters that can be money get through (digits, one point, two decimals).
 * The text it holds is what parseNaira() reads, so what's typed is what's saved.
 *
 * `onChangeText` receives the SANITISED text, so a caller never has to defend
 * against "-5" or "1e3" and the box can't show them either.
 */
export default function NairaField({
  label, value, onChangeText, placeholder, error, flex, accessibilityLabel,
}: {
  /** Omit when the field sits inline with others (the legacy add-item row). */
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string | null;
  /** Share a row with siblings. */
  flex?: number;
  accessibilityLabel?: string;
}) {
  return (
    <View style={[{ gap: 6 }, flex != null && { flex }]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.box, !!error && styles.boxError]}>
        <Text style={styles.symbol} accessible={false}>{NAIRA_SYMBOL}</Text>
        <TextInput
          value={value}
          onChangeText={(t) => onChangeText(sanitizeNairaInput(t))}
          placeholder={placeholder ?? '0.00'}
          placeholderTextColor={Colors.outline}
          keyboardType="decimal-pad"
          inputMode="decimal"
          autoCorrect={false}
          selectTextOnFocus
          maxLength={16}
          accessibilityLabel={accessibilityLabel ?? `${label ?? 'Price'} in naira`}
          style={styles.input}
        />
        <Text style={styles.code} accessible={false}>{CURRENCY_CODE}</Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' },
  box: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, backgroundColor: Colors.background,
  },
  boxError: { borderColor: Colors.error },
  symbol: { color: Colors.onSurface, fontSize: 16, fontWeight: '700' },
  input: { flex: 1, paddingVertical: 10, color: Colors.onSurface, fontSize: 15 },
  code: { color: Colors.onSurfaceVariant, fontSize: 12, fontWeight: '600' },
  error: { color: Colors.error, fontSize: 13 },
});
