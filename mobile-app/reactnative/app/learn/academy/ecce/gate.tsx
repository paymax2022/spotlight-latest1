import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';

/**
 * E3 — Parent gate. An age/math gate shown before settings or purchases inside
 * the kids surface. Kids can't solve it; parents can. On success, routes to the
 * `next` deep link (or settings) — blocking minors from reaching paid/admin areas.
 *
 * Usage: router.push('/learn/academy/ecce/gate?next=/learn/academy/wallet')
 */
export default function ParentGate() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  // Two-digit multiplication is beyond pre-primary reach (age gate via math).
  const { a, b } = useMemo(() => ({ a: 6 + Math.floor(Math.random() * 7), b: 7 + Math.floor(Math.random() * 6) }), []);
  const answer = a * b;
  const [error, setError] = useState(false);

  // Build four options: the correct answer plus three plausible distractors.
  const options = useMemo(() => {
    const set = new Set<number>([answer]);
    while (set.size < 4) set.add(answer + (Math.floor(Math.random() * 21) - 10));
    return Array.from(set).sort(() => Math.random() - 0.5);
  }, [answer]);

  const choose = (n: number) => {
    if (n === answer) {
      const target = (next as string) ?? '/learn/academy';
      router.replace(target as never);
    } else {
      setError(true);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Grown-ups only" />
      <View style={styles.center}>
        <View style={styles.icon}><Lock size={28} color={Colors.primary} /></View>
        <Text style={styles.title}>Ask a grown-up</Text>
        <Text style={styles.sub}>To open settings or make a purchase, please answer this question.</Text>

        <View style={[styles.questionCard, shadow1]}>
          <Text style={styles.question}>{a} × {b} = ?</Text>
        </View>

        <View style={styles.optionsGrid}>
          {options.map((n) => (
            <Pressable key={n} style={[styles.option, shadow1]} onPress={() => choose(n)}>
              <Text style={styles.optionText}>{n}</Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={styles.error}>That’s not right — please try again or ask a parent.</Text> : null}

        <View style={styles.note}>
          <ShieldCheck size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.noteText}>This keeps purchases and settings out of little hands.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  icon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  questionCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xl, marginTop: Spacing.md },
  question: { ...Typography.displayLg, color: Colors.primary, fontSize: 40, letterSpacing: -0.8, lineHeight: 46 },
  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  option: { width: '40%', alignItems: 'center', paddingVertical: Spacing.lg, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  optionText: { ...Typography.headlineMd, color: Colors.onSurface },
  error: { ...Typography.bodySm, color: Colors.error, textAlign: 'center', marginTop: Spacing.sm },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.lg },
  noteText: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
