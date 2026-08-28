import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { getPlacementQuiz, submitPlacement } from '@/features/academy/api';
import { useUpdateProfile } from '@/features/academy/hooks';
import type { PlacementQuiz, PlacementResult, PlacementLevel } from '@/features/academy/types';

const LEVEL_META: Record<PlacementLevel, { label: string; tint: string }> = {
  below_track: { label: 'Needs support', tint: Colors.error },
  on_track: { label: 'On track', tint: Colors.secondary },
  above_track: { label: 'Ahead', tint: Colors.tertiaryContainer },
};

/**
 * A10 — Curriculum-grounded placement quiz. Runs right after class select: a short
 * diagnostic drawn from the learner's class curriculum, scored per subject so we
 * can start them at the right point. Skippable — onboarding still completes.
 */
export default function PlacementScreen() {
  const { class: classParam } = useLocalSearchParams<{ class?: string }>();
  const classCode = typeof classParam === 'string' ? classParam : '';
  const updateProfile = useUpdateProfile();

  const [quiz, setQuiz] = useState<PlacementQuiz | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PlacementResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!classCode) return;
    setLoadError(false);
    getPlacementQuiz(classCode)
      .then((q) => { if (!cancelled) setQuiz(q); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [classCode]);

  const answeredCount = Object.keys(answers).length;
  const allAnswered = quiz ? answeredCount >= quiz.questions.length && quiz.questions.length > 0 : false;

  const select = (qid: string, optId: string) =>
    setAnswers((prev) => ({ ...prev, [qid]: [optId] }));

  const complete = (onDone?: () => void) =>
    updateProfile.mutate({ onboardingComplete: true }, { onSuccess: () => (onDone ?? (() => router.replace('/learn/academy')))() });

  const submit = () => {
    if (!quiz || !allAnswered) return;
    setSubmitting(true);
    submitPlacement(classCode, quiz.questions.map((q) => ({ questionId: q.id, selected: answers[q.id] ?? [] })))
      .then((r) => setResult(r))
      .catch(() => setResult(null))
      .finally(() => setSubmitting(false));
  };

  if (!classCode) {
    return (
      <Shell>
        <StateView kind="error" title="No class selected" message="Go back and pick your class first."
          actionLabel="Back" onAction={() => goBack('/learn/academy')} />
      </Shell>
    );
  }

  // ── Result view ─────────────────────────────────────────────────────────────
  if (result) {
    return (
      <Shell subtitle="Your starting point">
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.overallCard}>
            <Text style={styles.overallPct}>{Math.round(result.overallPct * 100)}%</Text>
            <Text style={styles.overallLabel}>overall on your class diagnostic</Text>
          </View>
          <Text style={styles.section}>By subject</Text>
          {result.subjects.map((s) => {
            const meta = LEVEL_META[s.level];
            return (
              <View key={s.code} style={styles.subjectRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subjectName}>{s.name}</Text>
                  <Text style={[styles.levelText, { color: meta.tint }]}>{meta.label} · {s.correct}/{s.total}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.round(s.scorePct * 100)}%`, backgroundColor: meta.tint }]} />
                </View>
              </View>
            );
          })}
          <Text style={styles.note}>We’ll use this to recommend where to start — you can always change pace later.</Text>
          <PrimaryButton label="Start learning" onPress={() => complete()} loading={updateProfile.isPending} />
        </ScrollView>
      </Shell>
    );
  }

  // ── Quiz view ───────────────────────────────────────────────────────────────
  return (
    <Shell subtitle="Quick placement check">
      {loadError ? (
        <StateView kind="error" title="Couldn't load the quiz"
          actionLabel="Skip for now" onAction={() => complete()} />
      ) : !quiz ? (
        <StateView kind="loading" message="Building your diagnostic…" />
      ) : quiz.questions.length === 0 ? (
        <StateView kind="empty" icon="ClipboardCheck" title="No diagnostic yet"
          message="We don’t have placement questions for this class yet — you can start straight away."
          actionLabel="Continue" onAction={() => complete()} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.lead}>Answer a few questions so we can pitch your lessons at the right level. {answeredCount}/{quiz.questions.length} answered.</Text>
          {quiz.questions.map((q, i) => (
            <View key={q.id} style={styles.qCard}>
              <Text style={styles.qSubject}>{q.subjectName}</Text>
              <Text style={styles.qStem}>{i + 1}. {q.stem}</Text>
              {q.options.map((opt) => {
                const selected = (answers[q.id] ?? []).includes(opt.id);
                return (
                  <Pressable key={opt.id} onPress={() => select(q.id, opt.id)}
                    style={[styles.opt, selected && styles.optSelected]}>
                    <View style={[styles.radio, selected && styles.radioOn]} />
                    <Text style={[styles.optText, selected && styles.optTextSelected]}>{opt.text}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <PrimaryButton label="See my placement" onPress={submit} loading={submitting} disabled={!allAnswered} />
          <Pressable onPress={() => complete()} style={styles.skip}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </ScrollView>
      )}
    </Shell>
  );
}

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Placement" subtitle={subtitle} />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  lead: { color: Colors.onSurfaceVariant, fontSize: 14 },
  section: { color: Colors.onSurface, fontSize: 16, fontWeight: '700', marginTop: Spacing.sm },
  note: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: Spacing.xs },

  qCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  qSubject: { color: Colors.primary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  qStem: { color: Colors.onSurface, fontSize: 15, fontWeight: '600' },
  opt: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 10, paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  optSelected: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  optText: { color: Colors.onSurface, fontSize: 15, flex: 1 },
  optTextSelected: { fontWeight: '700' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: Colors.outline },
  radioOn: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  skip: { alignSelf: 'center', paddingVertical: Spacing.sm },
  skipText: { color: Colors.onSurfaceVariant, fontSize: 14, fontWeight: '600' },

  overallCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg,
    alignItems: 'center', borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  overallPct: { color: Colors.primary, fontSize: 40, fontWeight: '800' },
  overallLabel: { color: Colors.onSurfaceVariant, fontSize: 13 },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  subjectName: { color: Colors.onSurface, fontSize: 15, fontWeight: '600' },
  levelText: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  barTrack: { width: 90, height: 8, borderRadius: 4, backgroundColor: Colors.outlineVariant, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
});
