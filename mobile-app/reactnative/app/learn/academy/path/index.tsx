import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Route, Lock, CheckCircle2, PlayCircle, Circle, Target } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import Chip from '@/features/academy/components/Chip';
import { useMe, useSubjects, usePath } from '@/features/academy/hooks';
import type { LearningStep } from '@/features/academy/types';

/**
 * "My path" — adaptive learning path backed by GET /progression/paths/:subjectId.
 * Pick a subject, then walk the ordered steps (locked → available → in_progress →
 * mastered). Each actionable step deep-links into the lesson/practice rail.
 */
export default function MyPath() {
  const me = useMe();
  const subjects = useSubjects(me.data?.classCode);
  const [subjectId, setSubjectId] = useState<string | undefined>(undefined);
  const activeSubject = subjectId ?? subjects.data?.[0]?.id;
  const path = usePath(activeSubject);

  if (subjects.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading your path…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My path" subtitle="Your personalised route to mastery" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Subject selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {subjects.data?.map((s) => {
            const active = s.id === activeSubject;
            return (
              <Pressable key={s.id} onPress={() => setSubjectId(s.id)} style={[styles.tab, active && styles.tabActive]}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{s.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {path.isLoading ? (
          <StateView kind="loading" message="Building your path…" compact />
        ) : path.isError || !path.data ? (
          <StateView kind="empty" title="No path yet" message="Complete a diagnostic or some practice to generate your path." compact />
        ) : (
          <>
            <View style={[styles.summary, shadow1]}>
              <View style={styles.summaryTop}>
                <View style={styles.routeIcon}><Route size={20} color={Colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryTitle}>{path.data.subjectName}</Text>
                  <Text style={styles.summarySub}>{path.data.progressPct}% of this path complete</Text>
                </View>
              </View>
              <ProgressBar pct={path.data.progressPct} style={{ marginTop: Spacing.sm }} />
            </View>

            {path.data.steps.map((step, i) => (
              <StepRow key={step.objectiveId} step={step} last={i === path.data!.steps.length - 1} />
            ))}

            <Pressable style={styles.adaptiveCta} onPress={() => router.push({ pathname: '/learn/academy/practice/adaptive', params: { subjectId: activeSubject } })}>
              <Target size={18} color={Colors.onPrimary} />
              <Text style={styles.adaptiveText}>Drill my weak spots (adaptive)</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StepRow({ step, last }: { step: LearningStep; last: boolean }) {
  const locked = step.status === 'locked';
  const meta = {
    locked: { Icon: Lock, color: Colors.onSurfaceVariant, label: 'Locked', bg: Colors.surfaceContainerHigh },
    available: { Icon: Circle, color: Colors.secondary, label: 'Start', bg: Colors.iconBgBlue },
    in_progress: { Icon: PlayCircle, color: Colors.gold, label: 'In progress', bg: Colors.iconBgGold },
    mastered: { Icon: CheckCircle2, color: Colors.teal, label: 'Mastered', bg: Colors.iconBgTeal },
  }[step.status];

  const go = () => {
    if (locked) return;
    router.push(`/learn/academy/practice/${step.objectiveId}`);
  };

  return (
    <Pressable onPress={go} disabled={locked} style={[styles.step, shadow1, locked && styles.stepLocked]}>
      <View style={styles.timeline}>
        <View style={[styles.node, { backgroundColor: meta.bg }]}><meta.Icon size={16} color={meta.color} /></View>
        {!last ? <View style={styles.connector} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.stepHead}>
          <Text style={styles.stepTitle} numberOfLines={2}>{step.title}</Text>
          <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
        </View>
        <Text style={styles.stepRationale}>{step.rationale}</Text>
        <View style={styles.stepFoot}>
          <ProgressBar pct={step.masteryPct} height={6} style={{ flex: 1 }} />
          <Text style={styles.stepMeta}>{step.masteryPct}% · {step.estMinutes}m</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  tabs: { gap: Spacing.sm, paddingBottom: Spacing.xs },
  tab: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  tabTextActive: { color: Colors.onPrimary, fontWeight: '700' },
  summary: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  routeIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { ...Typography.titleMd, color: Colors.onSurface },
  summarySub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  step: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  stepLocked: { opacity: 0.6 },
  timeline: { alignItems: 'center', width: 32 },
  node: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  connector: { width: 2, flex: 1, backgroundColor: Colors.outlineVariant, marginTop: 4 },
  stepHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, justifyContent: 'space-between' },
  stepTitle: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  stepRationale: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 4 },
  stepFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  stepMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  adaptiveCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.lg, height: 52, marginTop: Spacing.sm },
  adaptiveText: { ...Typography.labelLg, color: Colors.onPrimary },
});
