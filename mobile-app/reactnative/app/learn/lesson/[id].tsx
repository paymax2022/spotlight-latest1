import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Clock, FileText, PlayCircle, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useLesson, useLearnPath, useQuiz } from '@/features/learn/hooks/useLearn';

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lesson = useLesson(id);
  const path = useLearnPath(lesson.data?.pathId);
  const quiz = useQuiz(id);
  const [completed, setCompleted] = useState(false);

  const nextLessonId = useMemo(() => {
    const ids = path.data?.lessonIds ?? [];
    const idx = ids.indexOf(id ?? '');
    return idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : undefined;
  }, [path.data, id]);

  if (lesson.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Lesson" />
        <StateView kind="loading" message="Loading lesson…" />
      </SafeAreaView>
    );
  }

  if (lesson.isError || !lesson.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Lesson" />
        <StateView kind="error" title="Couldn't load this lesson" message="Please try again." actionLabel="Retry" onAction={() => lesson.refetch()} />
      </SafeAreaView>
    );
  }

  const l = lesson.data;
  const KindIcon = l.kind === 'video' ? PlayCircle : FileText;
  const paragraphs = l.body.split('\n\n');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={l.kind === 'video' ? 'Video' : 'Article'} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <KindIcon size={13} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.metaText}>{l.kind === 'video' ? 'Video' : 'Article'}</Text>
          </View>
          <View style={styles.metaChip}>
            <Clock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.metaText}>{l.durationMins} min</Text>
          </View>
        </View>

        <Text style={styles.title}>{l.title}</Text>
        <Text style={styles.summary}>{l.summary}</Text>

        <View style={styles.body}>
          {paragraphs.map((para, i) => (
            <Text key={i} style={styles.para}>{para}</Text>
          ))}
        </View>

        {/* Mark complete */}
        <Pressable
          onPress={() => setCompleted((c) => !c)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          style={[styles.complete, completed && styles.completeDone]}
        >
          <CheckCircle2 size={20} color={completed ? Colors.teal : Colors.outline} strokeWidth={2} />
          <Text style={[styles.completeText, completed && styles.completeTextDone]}>
            {completed ? 'Marked as complete' : 'Mark as complete'}
          </Text>
        </Pressable>

        {/* Take quiz (only if one exists) */}
        {quiz.data ? (
          <View style={styles.quizCta}>
            <PrimaryButton label="Take the quiz" onPress={() => router.push(`/learn/quiz/${l.id}`)} />
          </View>
        ) : null}

        {/* Next lesson */}
        {nextLessonId ? (
          <Pressable
            style={styles.next}
            accessibilityRole="button"
            onPress={() => router.replace(`/learn/lesson/${nextLessonId}`)}
          >
            <View style={styles.flex}>
              <Text style={styles.nextLabel}>Up next</Text>
              <NextLessonTitle id={nextLessonId} />
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function NextLessonTitle({ id }: { id: string }) {
  const lesson = useLesson(id);
  return <Text style={styles.nextTitle} numberOfLines={1}>{lesson.data?.title ?? 'Next lesson'}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  flex: { flex: 1 },

  metaRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  title: { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.md },
  summary: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs, lineHeight: 24 },
  body: { marginTop: Spacing.lg, gap: Spacing.md },
  para: { ...Typography.bodyMd, color: Colors.onSurface, lineHeight: 26 },

  complete: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'center',
    marginTop: Spacing.xl, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh,
    paddingVertical: Spacing.md,
  },
  completeDone: { borderColor: Colors.teal, backgroundColor: Colors.iconBgTeal },
  completeText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  completeTextDone: { color: Colors.teal },

  quizCta: { marginTop: Spacing.md },

  next: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.lg,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  nextLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  nextTitle: { ...Typography.labelLg, color: Colors.onSurface, marginTop: 1 },
});
