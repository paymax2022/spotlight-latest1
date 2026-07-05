import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { scoreWord } from '../constants/stays.constants';

interface Props {
  label: string;
  value: number; // 0..10 (0 = unset)
  onChange: (v: number) => void;
}

/** 1–10 sub-score selector used on the write-review screen (PRD §14). */
export default function ScoreSelector({ label, value, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.word}>{value > 0 ? `${value} · ${scoreWord(value)}` : 'Not rated'}</Text>
      </View>
      <View style={styles.row}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const on = value >= n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              style={[styles.pip, on && styles.pipOn]}
              accessibilityRole="button"
              accessibilityLabel={`${label} score ${n}`}
            >
              <Text style={[styles.pipText, on && styles.pipTextOn]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  word: { ...Typography.caption, color: Colors.onSurfaceVariant },
  row: { flexDirection: 'row', gap: 4 },
  pip: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: Radius.DEFAULT,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pipText: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '700' as const },
  pipTextOn: { color: Colors.onPrimary },
});
