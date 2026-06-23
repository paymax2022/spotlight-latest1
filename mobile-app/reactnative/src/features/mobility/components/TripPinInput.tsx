import React, { useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  error?: string;
  autoFocus?: boolean;
}

/** 4-digit trip PIN entry (driver verifies the rider's PIN before starting). */
export default function TripPinInput({ value, onChange, length = 4, error, autoFocus }: Props) {
  const inputRef = useRef<TextInput>(null);
  const digits = value.padEnd(length).slice(0, length).split('');

  return (
    <View>
      <Pressable style={styles.boxes} onPress={() => inputRef.current?.focus()}>
        {digits.map((d, i) => {
          const active = i === value.length;
          return (
            <View key={i} style={[styles.box, active && styles.boxActive, !!error && styles.boxError]}>
              <Text style={styles.digit}>{d.trim()}</Text>
            </View>
          );
        })}
      </Pressable>

      {/* Hidden controlling input */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus={autoFocus}
        style={styles.hidden}
        accessibilityLabel="Trip PIN"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  boxes: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center' },
  box: {
    width: 56, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center',
  },
  boxActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  boxError: { borderColor: Colors.error },
  digit: { ...Typography.headlineMd, color: Colors.onSurface },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm, textAlign: 'center' },
});
