// A NATIVE screen. Modules and lessons for the enrolled learner, with progress.
// "Locked" is a first-class state, not an error: an applicant who has not been
// approved or has not paid gets a reason and a way forward, because a blank
// screen here reads as a broken app.

import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleCheck, Circle, Lock, Clock, BookOpen, CheckCircle2, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { getCurriculum, FILM_ACADEMY_LEARN_KEY } from '@/features/filmAcademy/api';
import { lockCopy } from '@/features/filmAcademy/lockCopy';
import type { FilmAcademyLesson, FilmAcademyModule } from '@/features/filmAcademy/types';
import { HomeMenuButton } from '@/components/HomeMenu';

function ModuleQuizSection({ module, isLessonsComplete }: { module: FilmAcademyModule; isLessonsComplete: boolean }) {
  if (!module.quiz) return null;

  const quiz = module.quiz;
  const hasAttempted = !!quiz.lastResult;
  const passed = hasAttempted && quiz.lastResult!.passed;
  const score = hasAttempted ? quiz.lastResult!.scorePercent : null;

  return (
    <View style={styles.quizSection}>
      <View style={styles.quizHeader}>
        <BookOpen size={20} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.quizTitle}>{quiz.title}</Text>
          <Text style={styles.quizMeta}>Pass mark: {quiz.passMark}%</Text>
        </View>
      </View>

      {!isLessonsComplete && (
        <View style={[styles.quizState, { backgroundColor: Colors.surfaceVariant }]}>
          <AlertCircle size={16} color={Colors.onSurfaceVariant} />
          <Text style={styles.quizStateText}>Complete all lessons first</Text>
        </View>
      )}

      {isLessonsComplete && !hasAttempted && (
        <Pressable
          onPress={() => router.push(`/film-academy/exams/${quiz.id}` as never)}
          style={[styles.quizButton, { backgroundColor: Colors.primary }]}
        >
          <Text style={styles.quizButtonText}>Take Quiz</Text>
          <ChevronRight size={16} color={Colors.onPrimary} />
        </Pressable>
      )}

      {hasAttempted && (
        <View style={[styles.quizResult, { backgroundColor: passed ? Colors.teal + '15' : Colors.error + '15' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            {passed ? (
              <CheckCircle2 size={20} color={Colors.teal} />
            ) : (
              <AlertCircle size={20} color={Colors.error} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ ...Typography.labelMd, color: Colors.onSurface }}>
                {passed ? 'Quiz Passed' : 'Quiz Failed'}
              </Text>
              <Text style={{ ...Typography.bodySm, color: Colors.onSurfaceVariant }}>
                Score: {score}%
              </Text>
            </View>
          </View>
          {!passed && (
            <Pressable
              onPress={() => router.push(`/film-academy/exams/${quiz.id}` as never)}
              style={[styles.retryButton, { borderColor: Colors.error }]}
            >
              <Text style={{ ...Typography.labelSm, color: Colors.error }}>Retry</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function ModuleLockedOverlay() {
  return (
    <View style={styles.lockedOverlay}>
      <Lock size={24} color={Colors.error} />
      <Text style={styles.lockedText}>Locked</Text>
      <Text style={styles.lockedDetail}>Complete previous module quiz at 85%</Text>
    </View>
  );
}

function LessonRow({ lesson }: { lesson: FilmAcademyLesson }) {
  return (
    <Pressable
      onPress={() => router.push(`/film-academy/lesson/${lesson.id}` as never)}
      style={styles.lessonRow}
    >
      {lesson.completed
        ? <CircleCheck size={18} color={Colors.teal} />
        : <Circle size={18} color={Colors.onSurfaceVariant} />}
      <View style={styles.lessonBody}>
        <Text style={[styles.lessonTitle, lesson.completed && styles.lessonTitleDone]}>
          {lesson.title}
        </Text>
        {!!lesson.estimated_minutes && (
          <View style={styles.lessonMetaRow}>
            <Clock size={12} color={Colors.onSurfaceVariant} />
            <Text style={styles.lessonMeta}>{lesson.estimated_minutes} min</Text>
          </View>
        )}
      </View>
      <ChevronRight size={16} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

export default function FilmAcademyLearnScreen() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: FILM_ACADEMY_LEARN_KEY,
    queryFn: getCurriculum,
  });

  const pct = data && data.totalLessons > 0
    ? Math.round((data.completedLessons / data.totalLessons) * 100)
    : 0;

  const lock = lockCopy(data?.reason);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>My course</Text>
        <HomeMenuButton />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Loading your course…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>Could not load your course.</Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !error && data?.locked && (
          <View style={styles.state}>
            <Lock size={28} color={Colors.onSurfaceVariant} />
            <Text style={styles.lockTitle}>{lock.title}</Text>
            <Text style={styles.stateText}>{lock.detail}</Text>
            {!!lock.cta && (
              <Pressable onPress={() => router.push(lock.cta!.route as never)} style={styles.retry}>
                <Text style={styles.retryText}>{lock.cta.label}</Text>
              </Pressable>
            )}
          </View>
        )}

        {!isLoading && !error && !data?.locked && (
          <>
            <View style={styles.card}>
              <Text style={styles.progressPct}>{pct}%</Text>
              <Text style={styles.cardMeta}>
                {data!.completedLessons} of {data!.totalLessons} lesson
                {data!.totalLessons === 1 ? '' : 's'} complete
              </Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${pct}%` }]} />
              </View>
              <Pressable
                onPress={() => router.push('/film-academy/assignments' as never)}
                style={styles.assignLink}
              >
                <Text style={styles.assignLinkText}>My assignments</Text>
                <ChevronRight size={16} color={Colors.gold} />
              </Pressable>
            </View>

            {data!.modules.length === 0 && (
              <View style={styles.state}>
                <Text style={styles.stateText}>
                  No lessons have been published yet. Check back soon.
                </Text>
              </View>
            )}

            {data!.modules.map((m) => {
              const isLessonsComplete = m.lessons.length > 0 && m.completedCount === m.lessons.length;
              return (
                <View key={m.id} style={[styles.card, m.isLocked && styles.cardLocked]}>
                  {m.isLocked && <ModuleLockedOverlay />}
                  <Text style={styles.moduleTitle}>{m.title}</Text>
                  {!!m.description && <Text style={styles.cardMeta}>{m.description}</Text>}
                  <Text style={styles.moduleMeta}>
                    {m.completedCount} of {m.lessons.length} complete
                  </Text>
                  {m.lessons.map((l) => <LessonRow key={l.id} lesson={l} />)}
                  {!m.isLocked && (
                    <ModuleQuizSection module={m} isLessonsComplete={isLessonsComplete} />
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },

  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  lockTitle:   { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs },
  cardMeta:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  progressPct: { ...Typography.headlineMd, color: Colors.onSurface },
  bar:         { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceVariant,
                 overflow: 'hidden', marginTop: Spacing.xs },
  barFill:     { height: 6, borderRadius: 3, backgroundColor: Colors.gold },
  assignLink:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 marginTop: Spacing.sm },
  assignLinkText: { ...Typography.labelLg, color: Colors.onWarning },

  moduleTitle: { ...Typography.titleMd, color: Colors.onSurface },
  moduleMeta:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },

  lessonRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceVariant },
  lessonBody:  { flex: 1, gap: 2 },
  lessonTitle: { ...Typography.bodyMd, color: Colors.onSurface },
  lessonTitleDone: { color: Colors.onSurfaceVariant },
  lessonMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lessonMeta:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  quizSection: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1,
                 borderTopColor: Colors.surfaceVariant, gap: Spacing.md },
  quizHeader:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  quizTitle:   { ...Typography.labelLg, color: Colors.onSurface },
  quizMeta:    { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  quizState:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.sm },
  quizStateText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  quizButton:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.md },
  quizButtonText: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '600' },
  quizResult:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderRadius: Radius.sm },
  retryButton: { borderWidth: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
                 borderRadius: Radius.sm },

  cardLocked:  { position: 'relative', opacity: 0.6 },
  lockedOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                   backgroundColor: Colors.background, borderRadius: Radius.lg,
                   alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  lockedText:  { ...Typography.titleSm, color: Colors.onSurface },
  lockedDetail: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center',
                  paddingHorizontal: Spacing.md },
});
