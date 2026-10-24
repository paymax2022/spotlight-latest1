// "What do I do now?" card for the Film Academy: continue the next lesson, take the
// pending module quiz, or see that the course is finished. Shared by My course and the
// Academy home so both point the learner at the same next step (see journey.ts nextStep).

import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Play, ClipboardCheck, PartyPopper, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import type { NextStep } from '../journey';

type Props = {
  step: NextStep;
  /** Called for the quiz step; the lesson step navigates itself. */
  onStartQuiz: (quizId: string) => void;
  starting?: boolean;
};

export default function ContinueCard({ step, onStartQuiz, starting }: Props) {
  if (step.type === 'complete') {
    return (
      <View style={[styles.card, styles.cardDone]} accessibilityRole="text">
        <View style={[styles.iconBox, { backgroundColor: Colors.iconBgTeal }]}>
          <PartyPopper size={22} color={Colors.teal} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>Course complete</Text>
          <Text style={styles.sub}>You have finished every lesson and passed every module quiz.</Text>
        </View>
      </View>
    );
  }

  const isQuiz = step.type === 'quiz';
  const onPress = () => {
    if (step.type === 'quiz') onStartQuiz(step.quizId);
    else router.push(`/film-academy/lesson/${step.lessonId}` as never);
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={starting}
      style={({ pressed }) => [styles.card, styles.cardAction, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      accessibilityState={{ busy: !!starting, disabled: !!starting }}
      accessibilityLabel={isQuiz ? `Take the quiz: ${step.title}` : `Continue learning: ${step.title}`}
    >
      <View style={[styles.iconBox, { backgroundColor: Colors.onPrimary }]}>
        {starting
          ? <ActivityIndicator color={Colors.primary} />
          : isQuiz
            ? <ClipboardCheck size={22} color={Colors.primary} />
            : <Play size={22} color={Colors.primary} />}
      </View>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>{isQuiz ? 'Next up · Module quiz' : 'Continue learning'}</Text>
        <Text style={styles.titleOn} numberOfLines={2}>{step.title}</Text>
        <Text style={styles.subOn} numberOfLines={1}>{step.moduleTitle}</Text>
      </View>
      <ChevronRight size={20} color={Colors.onPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
                padding: Spacing.lg, borderRadius: Radius.lg },
  cardAction: { backgroundColor: Colors.primary },
  cardDone:   { backgroundColor: Colors.surface },
  iconBox:    { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body:       { flex: 1, gap: 2 },
  eyebrow:    { ...Typography.labelSm, color: Colors.primaryFixedDim },
  title:      { ...Typography.titleMd, color: Colors.onSurface },
  sub:        { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  titleOn:    { ...Typography.titleMd, color: Colors.onPrimary },
  subOn:      { ...Typography.bodySm, color: Colors.primaryFixedDim },
});
