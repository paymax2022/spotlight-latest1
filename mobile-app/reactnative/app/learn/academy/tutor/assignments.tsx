import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookOpen, FileCheck2, PencilLine, CalendarClock, Plus, CheckCircle2 } from 'lucide-react-native';
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
import { useAssignments, useCohorts, useCreateAssignment } from '@/features/academy/hooks';
import type { AssignmentKind } from '@/features/academy/types';

const KIND_META: Record<AssignmentKind, { label: string; icon: typeof BookOpen; color: string; bg: string }> = {
  lesson:     { label: 'Lesson',     icon: BookOpen,   color: Colors.secondary, bg: Colors.iconBgBlue },
  assessment: { label: 'Assessment', icon: FileCheck2, color: Colors.onWarning, bg: Colors.iconBgGold },
  homework:   { label: 'Homework',   icon: PencilLine, color: Colors.teal,      bg: Colors.iconBgTeal },
};

const DUE_OPTIONS = [
  { label: 'In 3 days', days: 3 },
  { label: 'In 1 week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
];

/** T4 — Assign content/homework: push lessons/assessments with due dates. */
export default function TutorAssignments() {
  const assignments = useAssignments();
  const cohorts = useCohorts();
  const create = useCreateAssignment();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AssignmentKind>('homework');
  const [title, setTitle] = useState('');
  const [cohortId, setCohortId] = useState<string | undefined>(undefined);
  const [dueDays, setDueDays] = useState(7);
  const [error, setError] = useState<string | null>(null);

  if (assignments.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading assignments…" /></SafeAreaView>;

  const cohort = cohortId ?? cohorts.data?.[0]?.id;
  const valid = title.trim().length >= 3 && !!cohort;

  const submit = () => {
    setError(null);
    if (!cohort) return;
    create.mutate(
      { cohortId: cohort, kind, title: title.trim(), dueDate: new Date(Date.now() + dueDays * 86_400_000).toISOString() },
      {
        onSuccess: () => { setOpen(false); setTitle(''); },
        onError: (e) => setError(e instanceof Error ? e.message : 'Could not assign'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Assignments"
        subtitle="Push work to cohorts"
        rightSlot={<Pressable hitSlop={10} onPress={() => setOpen((o) => !o)} accessibilityLabel="New assignment"><Plus size={22} color={Colors.primary} /></Pressable>}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Composer */}
        {open ? (
          <View style={[styles.composer, shadow1]}>
            <Text style={styles.composerTitle}>New assignment</Text>
            <View style={styles.kindRow}>
              {(Object.keys(KIND_META) as AssignmentKind[]).map((k) => {
                const m = KIND_META[k];
                const on = kind === k;
                return (
                  <Pressable key={k} style={[styles.kindBtn, on && styles.kindBtnOn]} onPress={() => setKind(k)}>
                    <m.icon size={16} color={on ? Colors.onPrimary : Colors.onSurfaceVariant} />
                    <Text style={[styles.kindText, on && { color: Colors.onPrimary }]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput style={styles.input} placeholder="Title (e.g. Quadratics exercise 5)" placeholderTextColor={Colors.onSurfaceVariant} value={title} onChangeText={setTitle} />
            <Text style={styles.fieldLabel}>Cohort</Text>
            <View style={styles.pillRow}>
              {cohorts.data?.map((c) => {
                const on = (cohortId ?? cohorts.data?.[0]?.id) === c.id;
                return (
                  <Pressable key={c.id} style={[styles.pill, on && styles.pillOn]} onPress={() => setCohortId(c.id)}>
                    <Text style={[styles.pillText, on && styles.pillTextOn]}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.fieldLabel}>Due</Text>
            <View style={styles.pillRow}>
              {DUE_OPTIONS.map((d) => {
                const on = dueDays === d.days;
                return (
                  <Pressable key={d.days} style={[styles.pill, on && styles.pillOn]} onPress={() => setDueDays(d.days)}>
                    <Text style={[styles.pillText, on && styles.pillTextOn]}>{d.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton label="Push to cohort" onPress={submit} loading={create.isPending} disabled={!valid} />
          </View>
        ) : null}

        {/* Existing assignments */}
        {assignments.data?.map((a) => {
          const m = KIND_META[a.kind];
          const done = a.gradedCount >= a.assignedCount;
          return (
            <View key={a.id} style={[styles.card, shadow1]}>
              <View style={[styles.icon, { backgroundColor: m.bg }]}><m.icon size={18} color={m.color} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{a.title}</Text>
                <Text style={styles.cardSub}>{a.cohortName}</Text>
                <View style={styles.metaRow}>
                  <View style={styles.dueRow}><CalendarClock size={12} color={Colors.onSurfaceVariant} /><Text style={styles.dueText}>Due {formatDate(a.dueDate)}</Text></View>
                  <Chip label={`${a.submittedCount}/${a.assignedCount} in`} color={Colors.secondary} bg={Colors.iconBgBlue} small />
                  {done ? <View style={styles.dueRow}><CheckCircle2 size={12} color={Colors.teal} /><Text style={[styles.dueText, { color: Colors.teal }]}>Graded</Text></View> : null}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  composer: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  composerTitle: { ...Typography.titleMd, color: Colors.onSurface },
  kindRow: { flexDirection: 'row', gap: Spacing.xs },
  kindBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  kindBtnOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  kindText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '700' },
  input: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 48, color: Colors.onSurface, ...Typography.bodyMd },
  fieldLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  pillOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { ...Typography.labelSm, color: Colors.onSurface },
  pillTextOn: { color: Colors.onPrimary, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  icon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  cardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 6, flexWrap: 'wrap' },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dueText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error, textAlign: 'center' },
});
