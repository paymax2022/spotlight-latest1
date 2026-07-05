import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface Props {
  label: string;
  selected?: boolean;
  /** Once an answer is revealed, mark this option as the correct one. */
  correct?: boolean;
  /** Disable interaction (after the answer is revealed). */
  revealed?: boolean;
  onPress?: () => void;
}

/**
 * Single selectable answer in the quiz flow. Before reveal it shows a radio-style
 * selection; after reveal it tints correct (teal) / wrong-but-chosen (error).
 */
export default function QuizOption({ label, selected, correct, revealed, onPress }: Props) {
  const showCorrect = revealed && correct;
  const showWrong = revealed && selected && !correct;

  return (
    <Pressable
      onPress={onPress}
      disabled={revealed}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected, disabled: !!revealed }}
      style={({ pressed }) => [
        styles.option,
        selected && !revealed && styles.selected,
        showCorrect && styles.correct,
        showWrong && styles.wrong,
        pressed && !revealed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.bullet,
          selected && !revealed && styles.bulletSelected,
          showCorrect && styles.bulletCorrect,
          showWrong && styles.bulletWrong,
        ]}
      >
        {showCorrect ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
        {showWrong ? <X size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
      </View>
      <Text style={[styles.label, (showCorrect || showWrong) && styles.labelStrong]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  selected: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLow },
  correct: { borderColor: Colors.teal, backgroundColor: Colors.iconBgTeal },
  wrong: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  pressed: { opacity: 0.85 },
  bullet: {
    width: 22, height: 22, borderRadius: Radius.full,
    borderWidth: 2, borderColor: Colors.outlineVariant,
    alignItems: 'center', justifyContent: 'center',
  },
  bulletSelected: { borderColor: Colors.secondary },
  bulletCorrect: { borderColor: Colors.teal, backgroundColor: Colors.teal },
  bulletWrong: { borderColor: Colors.error, backgroundColor: Colors.error },
  label: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  labelStrong: { fontWeight: '600' },
});
