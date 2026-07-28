import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { formatDate } from '@/features/academy/constants';
import { useSubmissions, useGradeSubmission } from '@/features/academy/hooks';
import type { Submission } from '@/features/academy/types';

const SCORES = [50, 60, 70, 80, 90, 100];

/** T5 — Review & grade: mark learner work, add feedback. Credits a grading bonus. */
export default function TutorGrade() {
  const subs = useSubmissions();
  const grade = useGradeSubmission();
  const [active, setActive] = useState<Submission | null>(null);
  const [score, setScore] = useState(80);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (subs.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading submissions…" /></SafeAreaView>;

  const pending = subs.data?.filter((s) => s.status === 'submitted') ?? [];
  const graded = subs.data?.filter((s) => s.status === 'graded') ?? [];

  const openGrader = (s: Submission) => { setActive(s); setScore(s.scorePct ?? 80); setFeedback(s.feedback ?? ''); setError(null); };

  const submit = () => {
    if (!active) return;
    setError(null);
    grade.mutate(
      { submissionId: active.id, scorePct: score, feedback: feedback.trim() },
      { onSuccess: () => setActive(null), onError: (e) => setError(e instanceof Error ? e.message : 'Could not save grade') },
    );
  };

  // Grading modal-style overlay (inline, no extra route).
  if (active) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Grade work" subtitle={active.studentName} onBack={() => setActive(null)} />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, shadow1]}>
            <Text style={styles.cardTitle}>{active.assignmentTitle}</Text>
            <Text style={styles.workLabel}>Submitted work</Text>
            <Text style={styles.work}>{active.workPreview}</Text>
          </View>

          <Text style={styles.section}>Score</Text>
          <View style={styles.scoreRow}>
            {SCORES.map((s) => {
              const on = score === s;
              return (
                <Pressable key={s} style={[styles.scoreBtn, on && styles.scoreBtnOn]} onPress={() => setScore(s)}>
                  <Text style={[styles.scoreText, on && { color: Colors.onPrimary }]}>{s}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>Feedback</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What did they do well? What to improve?"
            placeholderTextColor={Colors.onSurfaceVariant}
            value={feedback}
            onChangeText={setFeedback}
            multiline
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label={`Save grade · ${score}%`} onPress={submit} loading={grade.isPending} disabled={feedback.trim().length < 3} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Review & grade" subtitle={`${pending.length} awaiting`} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>Awaiting grade</Text>
        {pending.length === 0 ? <Text style={styles.empty}>All caught up. Nice work.</Text> : null}
        {pending.map((s) => (
          <Pressable key={s.id} style={[styles.card, shadow1]} onPress={() => openGrader(s)}>
            <View style={styles.rowTop}>
              <Text style={styles.studentName}>{s.studentName}</Text>
              <View style={styles.dueRow}><Clock size={12} color={Colors.onWarning} /><Text style={styles.dueText}>{formatDate(s.submittedAt)}</Text></View>
            </View>
            <Text style={styles.cardSub}>{s.assignmentTitle}</Text>
            <Text style={styles.preview} numberOfLines={2}>{s.workPreview}</Text>
            <Chip label="Tap to grade" color={Colors.secondary} bg={Colors.iconBgBlue} small />
          </Pressable>
        ))}

        {graded.length ? (
          <>
            <Text style={styles.section}>Graded</Text>
            {graded.map((s) => (
              <View key={s.id} style={[styles.card, shadow1]}>
                <View style={styles.rowTop}>
                  <Text style={styles.studentName}>{s.studentName}</Text>
                  <View style={styles.dueRow}><CheckCircle2 size={12} color={Colors.teal} /><Text style={[styles.dueText, { color: Colors.teal }]}>{s.scorePct}%</Text></View>
                </View>
                <Text style={styles.cardSub}>{s.assignmentTitle}</Text>
                {s.feedback ? <Text style={styles.preview}>{s.feedback}</Text> : null}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 6 },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  studentName: { ...Typography.labelLg, color: Colors.onSurface },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dueText: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '700' },
  preview: { ...Typography.bodySm, color: Colors.onSurface },
  workLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  work: { ...Typography.bodyMd, color: Colors.onSurface },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  scoreBtn: { width: '15%', flexGrow: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  scoreBtnOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  scoreText: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  input: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, paddingHorizontal: Spacing.md, color: Colors.onSurface, ...Typography.bodyMd, borderWidth: 1, borderColor: Colors.outlineVariant },
  textArea: { height: 100, paddingTop: Spacing.sm, textAlignVertical: 'top' },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
