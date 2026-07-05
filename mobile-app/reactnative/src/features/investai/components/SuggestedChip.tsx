import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { SuggestedQuestion } from '../types/ai.types';

interface Props {
  question: SuggestedQuestion;
  onPress: (question: SuggestedQuestion) => void;
  disabled?: boolean;
}

/** A tappable educational starter prompt (used on the intro + chat screens). */
export default function SuggestedChip({ question, onPress, disabled }: Props) {
  return (
    <Pressable
      onPress={() => onPress(question)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={question.text}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={styles.text}>{question.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.secondaryFixed,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  text: { ...Typography.labelMd, color: Colors.secondary },
});
