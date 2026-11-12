import React, { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

interface Props {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  error?: string;
  autoFocus?: boolean;
}

/**
 * 4-digit PIN entry (setup, payment authorisation, and the driver/courier
 * verification of the rider's PIN). Digits are masked by default like a password
 * and the eye button reveals them; the boxes only ever render one glyph per cell.
 */
export default function TripPinInput({ value, onChange, length = 4, error, autoFocus }: Props) {
  const inputRef = useRef<TextInput>(null);
  const [revealed, setRevealed] = useState(false);
  const digits = value.padEnd(length).slice(0, length).split('');

  return (
    <View>
      <Pressable style={styles.boxes} onPress={() => inputRef.current?.focus()}>
        {digits.map((d, i) => {
          const active = i === value.length;
          const filled = d.trim() !== '';
          return (
            <View key={i} style={[styles.box, active && styles.boxActive, !!error && styles.boxError]}>
              <Text style={styles.digit}>{filled ? (revealed ? d.trim() : '•') : ''}</Text>
            </View>
          );
        })}
      </Pressable>

      <Pressable
        onPress={() => { setRevealed((r) => !r); inputRef.current?.focus(); }}
        style={styles.toggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={revealed ? 'Hide PIN' : 'Show PIN'}
      >
        {revealed
          ? <EyeOff size={18} color={Colors.outline} />
          : <Eye    size={18} color={Colors.outline} />
        }
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
  toggle: { alignSelf: 'center', marginTop: Spacing.sm, padding: 4 },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm, textAlign: 'center' },
});
