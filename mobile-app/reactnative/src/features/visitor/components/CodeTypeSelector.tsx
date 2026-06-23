import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { CODE_TYPES } from '../constants/visitor.constants';
import type { CodeType } from '../types/visitor.types';

interface Props {
  value: CodeType;
  onChange: (type: CodeType) => void;
  // Only show types up to a given rollout phase (PRD §16). Default: all.
  maxPhase?: 1 | 2 | 3;
}

/** Horizontally scrollable selector of visitor code types (VM-102/103). */
export default function CodeTypeSelector({ value, onChange, maxPhase = 3 }: Props) {
  const types = CODE_TYPES.filter((t) => t.phase <= maxPhase);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {types.map((t) => {
        const selected = t.type === value;
        const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[t.icon] ?? Icons.UserRound;
        return (
          <Pressable
            key={t.type}
            onPress={() => onChange(t.type)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${t.label} access code`}
            style={[
              styles.chip,
              { backgroundColor: selected ? t.accent : t.bg, borderColor: selected ? t.accent : Colors.transparent },
            ]}
          >
            <Icon size={16} color={selected ? Colors.onPrimary : t.accent} strokeWidth={2} />
            <Text style={[styles.label, { color: selected ? Colors.onPrimary : t.accent }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.sm, paddingVertical: Spacing.xs, paddingRight: Spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    minHeight: 40,
  },
  label: { ...Typography.labelMd },
});
