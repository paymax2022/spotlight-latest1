// A labelled consent/confirmation tick used by both Open Mic cards.
//
// The registration wizard has the same control inside `FieldRenderer`, but that
// one is private and driven by a `RegistrationField` the server sends. These two
// rows are not server-driven — accepting the beat rules and declaring the song
// yours are fixed to the Open Mic contract — so the card owns a copy that speaks
// the same visual language rather than reaching into another feature's file.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';

interface Props {
  label: string;
  checked: boolean;
  onToggle: () => void;
  error?: string;
  disabled?: boolean;
}

export default function ConsentRow({ label, checked, onToggle, error, disabled }: Props) {
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled: !!disabled }}
        disabled={disabled}
        onPress={onToggle}
        style={styles.row}
      >
        <View style={[styles.box, checked && styles.boxOn, !!error && styles.boxError]}>
          {checked ? <Check size={15} color={Colors.onPrimary} strokeWidth={3} /> : null}
        </View>
        <Text style={[styles.label, checked && styles.labelOn]}>{label}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  box: {
    width: 20,
    height: 20,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  boxError: { borderColor: Colors.error },
  label: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  labelOn: { color: Colors.onSurface },
  error: { ...Typography.caption, color: Colors.error, marginLeft: 28 },
});
