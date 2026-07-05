import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Sparkles, RotateCcw, CheckCircle2, Hand } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useLesson } from '@/features/academy/hooks';
import { track } from '@/features/academy/analytics';

// Hands-on matching activity (no media/drag deps): match each trig ratio to its
// definition by tapping. Generic enough to stand in for any interactive lesson.
const PROMPTS = [
  { id: 'sin', label: 'sine (sin)', answer: 'opp / hyp' },
  { id: 'cos', label: 'cosine (cos)', answer: 'adj / hyp' },
  { id: 'tan', label: 'tangent (tan)', answer: 'opp / adj' },
];
const CHOICES = ['opp / hyp', 'adj / hyp', 'opp / adj'];

/** L8 — Interactive lesson: hands-on simulation/activity with instant checking. */
export default function InteractiveLesson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lesson = useLesson(id);

  const [picks, setPicks] = useState<Record<string, string>>({});
  const [activePrompt, setActivePrompt] = useState<string>(PROMPTS[0].id);
  const [checked, setChecked] = useState(false);

  const assign = (choice: string) => {
    setPicks((p) => ({ ...p, [activePrompt]: choice }));
    const order = PROMPTS.map((x) => x.id);
    const next = order[(order.indexOf(activePrompt) + 1) % order.length];
    setActivePrompt(next);
  };

  const allAssigned = PROMPTS.every((p) => picks[p.id]);
  const correctCount = PROMPTS.filter((p) => picks[p.id] === p.answer).length;
  const allCorrect = correctCount === PROMPTS.length;

  const reset = () => { setPicks({}); setActivePrompt(PROMPTS[0].id); setChecked(false); };
  const check = () => {
    setChecked(true);
    if (PROMPTS.every((p) => picks[p.id] === p.answer)) track('lesson_completed', { lesson: id, kind: 'interactive' });
  };

  if (lesson.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading activity…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Interactive lesson" subtitle={lesson.data?.title ?? 'Hands-on activity'} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
          <View style={styles.heroTop}><Hand size={16} color={Colors.gold} /><Text style={styles.heroKicker}>TRY IT</Text></View>
          <Text style={styles.heroText}>Match each trig ratio to its definition. Tap a ratio, then tap the answer.</Text>
        </LinearGradient>

        {/* Prompts */}
        <Text style={styles.section}>Ratios</Text>
        {PROMPTS.map((p) => {
          const pick = picks[p.id];
          const isActive = p.id === activePrompt && !checked;
          const correct = checked && pick === p.answer;
          const wrong = checked && pick && pick !== p.answer;
          return (
            <Pressable
              key={p.id}
              onPress={() => !checked && setActivePrompt(p.id)}
              style={[styles.prompt, shadow1, isActive && styles.promptActive, correct && styles.promptCorrect, wrong && styles.promptWrong]}
            >
              <Text style={styles.promptLabel}>{p.label}</Text>
              <View style={styles.slot}>
                <Text style={[styles.slotText, !pick && styles.slotEmpty]}>{pick ?? 'tap an answer →'}</Text>
                {correct ? <CheckCircle2 size={16} color={Colors.teal} /> : null}
              </View>
            </Pressable>
          );
        })}

        {/* Choices */}
        {!checked ? (
          <>
            <Text style={styles.section}>Answers</Text>
            <View style={styles.choices}>
              {CHOICES.map((c) => (
                <Pressable key={c} style={styles.choice} onPress={() => assign(c)}>
                  <Text style={styles.choiceText}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <View style={[styles.resultCard, { backgroundColor: allCorrect ? Colors.iconBgTeal : Colors.iconBgGold }]}>
            <Sparkles size={18} color={allCorrect ? Colors.teal : Colors.onWarning} />
            <Text style={[styles.resultText, { color: allCorrect ? Colors.teal : Colors.onWarning }]}>
              {allCorrect ? 'Perfect! You matched all three.' : `${correctCount} of ${PROMPTS.length} correct — try again.`}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {!checked ? (
          <PrimaryButton label="Check answers" onPress={check} disabled={!allAssigned} />
        ) : allCorrect ? (
          <PrimaryButton label="Done" onPress={() => router.back()} />
        ) : (
          <PrimaryButton label="Try again" variant="secondary" onPress={reset} />
        )}
        {!checked ? (
          <Pressable style={styles.resetRow} onPress={reset}><RotateCcw size={14} color={Colors.onSurfaceVariant} /><Text style={styles.resetText}>Reset</Text></Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  hero: { borderRadius: Radius.lg, padding: Spacing.md },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroKicker: { ...Typography.labelSm, color: Colors.gold, letterSpacing: 1, fontWeight: '700' },
  heroText: { ...Typography.bodyMd, color: Colors.onPrimary, marginTop: 4 },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  prompt: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  promptActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  promptCorrect: { borderColor: Colors.teal, backgroundColor: Colors.iconBgTeal },
  promptWrong: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  promptLabel: { ...Typography.titleMd, color: Colors.onSurface },
  slot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  slotText: { ...Typography.bodyMd, color: Colors.onSurface },
  slotEmpty: { color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  choice: { paddingHorizontal: Spacing.md, paddingVertical: 12, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerHigh },
  choiceText: { ...Typography.labelMd, color: Colors.onSurface },
  resultCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, marginTop: Spacing.sm },
  resultText: { ...Typography.bodyMd, fontWeight: '700', flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, gap: Spacing.sm },
  resetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  resetText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
