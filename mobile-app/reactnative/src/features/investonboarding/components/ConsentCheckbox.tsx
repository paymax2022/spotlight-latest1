import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  checked: boolean;
  onToggle: () => void;
  label: string;
}

/**
 * A square checkbox + label row for consents. Used both inline (agreement rows)
 * and standalone (e.g. "I confirm…" acknowledgements).
 */
export default function ConsentCheckbox({ checked, onToggle, label }: Props) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={styles.row}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  box: {
    width: 22, height: 22, borderRadius: Radius.sm,
    borderWidth: 2, borderColor: Colors.outlineVariant,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  boxChecked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  label: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
});
