import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { Question } from '../types';

interface Props {
  question: Question;
  selected: string[];
  onSelect: (optionId: string) => void;
  /** When set, locks input and shows correctness (results / instant feedback). */
  reveal?: boolean;
}

/**
 * Single MCQ / multi / true-false card. Reused by practice (L9) and the CBT
 * simulator (X7). `reveal` drives instant-feedback colouring.
 */
export default function QuestionCard({ question, selected, onSelect, reveal }: Props) {
  return (
    <View>
      <Text style={styles.stem}>{question.stem}</Text>
      {question.source ? <Text style={styles.source}>Source: {question.source}</Text> : null}
      <View style={{ gap: Spacing.sm, marginTop: Spacing.md }}>
        {question.options.map((opt) => {
          const isSelected = selected.includes(opt.id);
          const isCorrect = question.correct.includes(opt.id);
          let state: 'default' | 'selected' | 'right' | 'wrong' = 'default';
          if (reveal) {
            if (isCorrect) state = 'right';
            else if (isSelected) state = 'wrong';
          } else if (isSelected) {
            state = 'selected';
          }
          return (
            <Pressable
              key={opt.id}
              onPress={() => !reveal && onSelect(opt.id)}
              disabled={reveal}
              style={[styles.option, state === 'selected' && styles.optSelected, state === 'right' && styles.optRight, state === 'wrong' && styles.optWrong]}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
            >
              <View style={[styles.bullet, state === 'selected' && styles.bulletSelected, state === 'right' && styles.bulletRight, state === 'wrong' && styles.bulletWrong]}>
                {state === 'right' ? <Check size={14} color={Colors.white} strokeWidth={3} />
                  : state === 'wrong' ? <X size={14} color={Colors.white} strokeWidth={3} />
                  : isSelected ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
              </View>
              <Text style={[styles.optText, (state === 'right' || state === 'wrong') && styles.optTextStrong]}>{opt.text}</Text>
            </Pressable>
          );
        })}
      </View>
      {reveal ? (
        <View style={styles.explain}>
          <Text style={styles.explainLabel}>Explanation</Text>
          <Text style={styles.explainText}>{question.explanation}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stem: { ...Typography.titleMd, color: Colors.onSurface },
  source: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  optSelected: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  optRight: { borderColor: Colors.teal, backgroundColor: Colors.iconBgTeal },
  optWrong: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  bullet: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  bulletSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  bulletRight: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  bulletWrong: { backgroundColor: Colors.error, borderColor: Colors.error },
  optText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  optTextStrong: { fontWeight: '600' },
  explain: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow },
  explainLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  explainText: { ...Typography.bodySm, color: Colors.onSurface, marginTop: 4 },
});
