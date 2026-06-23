import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export default function VoteCounter({ value, onChange, min = 1, max = 100, step = 1 }: Props) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));

  return (
    <View style={styles.row}>
      <Pressable
        onPress={dec}
        disabled={value <= min}
        style={({ pressed }) => [styles.btn, value <= min && styles.btnDisabled, pressed && styles.pressed]}
      >
        <Minus size={18} color={value <= min ? Colors.outline : Colors.primary} strokeWidth={2.5} />
      </Pressable>
      <View style={styles.valueBox}>
        <Text style={styles.value}>{value}</Text>
        <Text style={styles.sub}>{value === 1 ? 'vote' : 'votes'}</Text>
      </View>
      <Pressable
        onPress={inc}
        disabled={value >= max}
        style={({ pressed }) => [styles.btn, value >= max && styles.btnDisabled, pressed && styles.pressed]}
      >
        <Plus size={18} color={value >= max ? Colors.outline : Colors.primary} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  btn: {
    width:          44,
    height:         44,
    borderRadius:   Radius.md,
    alignItems:     'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth:    1,
    borderColor:    Colors.surfaceContainerHigh,
  },
  btnDisabled: { opacity: 0.4 },
  pressed:     { opacity: 0.7 },
  valueBox:    { alignItems: 'center', minWidth: 60 },
  value:       { ...Typography.headlineMd, color: Colors.onSurface, lineHeight: 32 },
  sub:         { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
