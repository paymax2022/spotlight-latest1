import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Option { value: string; label: string; sub?: string }
interface Props {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}

/** Single-select radio list card, reused by language / theme settings. */
export default function OptionList({ options, value, onChange }: Props) {
  return (
    <View style={styles.card}>
      {options.map((o, i, arr) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={[styles.row, i < arr.length - 1 && styles.rowBorder]}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <View style={styles.body}>
              <Text style={styles.label}>{o.label}</Text>
              {o.sub ? <Text style={styles.sub}>{o.sub}</Text> : null}
            </View>
            {active && <Check size={20} color={Colors.secondary} strokeWidth={2.6} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  body: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
