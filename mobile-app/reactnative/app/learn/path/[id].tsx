import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import ProgressBar from '@/features/learn/components/ProgressBar';
import LessonRow from '@/features/learn/components/LessonRow';
import { LEVEL_STYLE } from '@/features/learn/constants/learn.constants';
import { useLearnPath, useLesson } from '@/features/learn/hooks/useLearn';

/** Tiny wrapper so each lesson id resolves its own LessonRow via the hook. */
function PathLesson({ id, index, onPress }: { id: string; index: number; onPress: () => void }) {
  const lesson = useLesson(id);
  if (!lesson.data) return null;
  return <LessonRow lesson={lesson.data} index={index} onPress={onPress} />;
}

export default function LearnPathScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const path = useLearnPath(id);

  if (path.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Path" />
        <StateView kind="loading" message="Loading lessons…" />
      </SafeAreaView>
    );
  }

  if (path.isError || !path.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Path" />
        <StateView kind="error" title="Couldn't load this path" message="Please try again." actionLabel="Retry" onAction={() => path.refetch()} />
      </SafeAreaView>
    );
  }

  const p = path.data;
  const level = LEVEL_STYLE[p.level];
  const firstLessonId = p.lessonIds[0];
  const started = p.progressPct > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={p.title} subtitle={`${p.lessonIds.length} lessons`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Path header card */}
        <View style={styles.headerCard}>
          <View style={[styles.chip, { backgroundColor: level.bg }]}>
            <Text style={[styles.chipText, { color: level.tint }]}>{level.label}</Text>
          </View>
          <Text style={styles.desc}>{p.description}</Text>
          <View style={styles.progressRow}>
            <ProgressBar pct={p.progressPct} color={p.iconColor} style={styles.bar} />
            <Text style={styles.pct}>{p.progressPct}%</Text>
          </View>
        </View>

        {/* Lessons */}
        <Text style={styles.sectionTitle}>Lessons</Text>
        <View style={styles.card}>
          {p.lessonIds.map((lessonId, i, arr) => (
            <View key={lessonId}>
              <PathLesson id={lessonId} index={i + 1} onPress={() => router.push(`/learn/lesson/${lessonId}`)} />
              {i < arr.length - 1 ? <View style={styles.divider} /> : null}
            </View>
          ))}
        </View>

        {firstLessonId ? (
          <View style={styles.cta}>
            <PrimaryButton
              label={started ? 'Continue learning' : 'Start path'}
              onPress={() => router.push(`/learn/lesson/${firstLessonId}`)}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },

  headerCard: {
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.cardPadding, gap: Spacing.md,
  },
  chip: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  chipText: { ...Typography.caption, fontWeight: '700' },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bar: { flex: 1 },
  pct: { ...Typography.labelSm, color: Colors.onSurfaceVariant, minWidth: 36, textAlign: 'right' },

  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  cta: { paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
});
