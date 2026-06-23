import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  label?:   string;
  options:  string[];
  selected: string[];
  onChange: (next: string[]) => void;
  max?:     number;   // optional cap on selections
}

// New component: a wrap-flow chip group for multi-select fields (languages,
// sub-specialties). SelectField is single-value + modal, so a tappable
// multi-select chip grid is justified rather than overloading it.
export default function ChipMultiSelect({ label, options, selected, onChange, max }: Props) {
  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt));
    } else {
      if (max && selected.length >= max) return;
      onChange([...selected, opt]);
    }
  };

  return (
    <View style={styles.wrap}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.grid}>
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <Pressable
              key={opt}
              onPress={() => toggle(opt)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={opt}
            >
              {on && <Check size={14} color={Colors.primary} strokeWidth={2.6} />}
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{opt}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:        { marginBottom: Spacing.md },
  label:       { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  grid:        { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLow },
  chipOn:      { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  chipText:    { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextOn:  { color: Colors.primary },
});
