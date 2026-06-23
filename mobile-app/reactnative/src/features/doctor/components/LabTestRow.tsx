import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { LabTest } from '@/types/doctor';

interface Props {
  test:     LabTest;
  selected: boolean;
  onToggle: (id: string) => void;
}

// New component: a selectable lab-test row with a checkbox for the lab-order
// builder. No existing component renders a toggle-able catalogue row, so this is
// genuinely new.
export default function LabTestRow({ test, selected, onToggle }: Props) {
  return (
    <Pressable
      onPress={() => onToggle(test.id)}
      style={[styles.row, selected && styles.rowSelected]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={test.name}
    >
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{test.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>{test.code} · {test.category}</Text>
      </View>
      <View style={[styles.checkbox, selected && styles.checkboxOn]}>
        {selected && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  rowSelected:{ borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  body:       { flex: 1, gap: 2 },
  name:       { ...Typography.labelLg, color: Colors.onSurface },
  meta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  checkbox:   { width: 24, height: 24, borderRadius: Radius.sm + 2, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
