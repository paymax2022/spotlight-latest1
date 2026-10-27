// A NATIVE screen. Modules and lessons for the enrolled learner, with progress.
// "Locked" is a first-class state, not an error: an applicant who has not been
// approved or has not paid gets a reason and a way forward, because a blank
// screen here reads as a broken app.

import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleCheck, Circle, Lock, Clock, BookOpen, CheckCircle2, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import {
  getCurriculum, startExamAttempt, FILM_ACADEMY_LEARN_KEY, FILM_ACADEMY_EXAMS_KEY,
} from '@/features/filmAcademy/api';
import { lockCopy } from '@/features/filmAcademy/lockCopy';
import {
  gateRefusal, gateRefusalMessage, lockedModuleMessage, scoreSummary,
} from '@/features/filmAcademy/moduleGate';
import { getErrorMessage } from '@/utils/errorMapper';
import { secureRandomId } from '@/lib/secureRandom';
import type { FilmAcademyLesson, FilmAcademyModule } from '@/features/filmAcademy/types';
import { HomeMenuButton } from '@/components/HomeMenu';

function ModuleQuizSection({ module, isLessonsComplete }: { module: FilmAcademyModule; isLessonsComplete: boolean }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);

  if (!module.quiz) return null;

  const quiz = module.quiz;
  const hasAttempted = !!quiz.lastResult;
  // Pass/fail is the server's verdict on exact points, never re-derived here.
  const passed = hasAttempted && quiz.lastResult!.passed === true;

  // The quiz route takes an ATTEMPT id, so start (or resume) one first. A refusal
  // from the module gate gets its own copy and refreshes the course, because it
  // means this screen's lock state is stale.
  const start = async () => {
    setBusy(true);
    setStartError(null);
    try {
      const attempt = await startExamAttempt(quiz.id, secureRandomId());
      void queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_EXAMS_KEY });
      router.push(`/film-academy/exams/${attempt.attemptId}` as never);
    } catch (e) {
      const refusal = gateRefusal(e);
      setStartError(refusal ? gateRefusalMessage(refusal) : getErrorMessage(e));
      if (refusal) void queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_LEARN_KEY });
    } finally {
      setBusy(false);
    }
  };

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

      {isLessonsComplete && !hasAttempted && quiz.canStart !== false && (
        <Pressable
          onPress={start}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
          style={[styles.quizButton, { backgroundColor: Colors.primary }, busy && styles.quizButtonBusy]}
        >
          <Text style={styles.quizButtonText}>Take Quiz</Text>
          {busy ? <ActivityIndicator color={Colors.onPrimary} /> : <ChevronRight size={16} color={Colors.onPrimary} />}
        </Pressable>
      )}

      {!!startError && (
        <Text style={styles.quizError} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {startError}
        </Text>
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
                Score: {scoreSummary(quiz.lastResult!)}
              </Text>
            </View>
          </View>
          {!passed && quiz.canStart !== false && (
            <Pressable
              onPress={start}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.retryButton, { borderColor: Colors.error }, busy && styles.quizButtonBusy]}
            >
              <Text style={{ ...Typography.labelSm, color: Colors.error }}>Retry</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// A locked module still shows its outline (titles only — the server blanks the
// lesson content), with the reason in words so it does not rely on the icon.
function ModuleLockedBanner({ message }: { message: string }) {
  return (
    <View style={styles.lockedBanner} accessible accessibilityLabel={`Locked. ${message}`}>
      <Lock size={18} color={Colors.onSurfaceVariant} />
      <View style={{ flex: 1 }}>
        <Text style={styles.lockedText}>Locked</Text>
        <Text style={styles.lockedDetail}>{message}</Text>
      </View>
    </View>
  );
}

function LessonRow({ lesson, locked }: { lesson: FilmAcademyLesson; locked?: boolean }) {
  if (locked) {
    return (
      <View style={styles.lessonRow} accessible accessibilityLabel={`${lesson.title}, locked`}>
        <Lock size={16} color={Colors.onSurfaceVariant} />
        <View style={styles.lessonBody}>
          <Text style={[styles.lessonTitle, styles.lessonTitleDone]}>{lesson.title}</Text>
          {!!lesson.estimated_minutes && (
            <Text style={styles.lessonMeta}>{lesson.estimated_minutes} min</Text>
          )}
        </View>
      </View>
    );
  }
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

            {data!.modules.map((m, idx) => {
              const isLessonsComplete = m.lessons.length > 0 && m.completedCount === m.lessons.length;
              return (
                <View key={m.id} style={styles.card}>
                  <Text style={styles.moduleTitle}>{m.title}</Text>
                  {!!m.description && <Text style={styles.cardMeta}>{m.description}</Text>}
                  {m.isLocked && <ModuleLockedBanner message={lockedModuleMessage(data!.modules, idx)} />}
                  <Text style={styles.moduleMeta}>
                    {m.completedCount} of {m.lessons.length} complete
                  </Text>
                  {m.lessons.map((l) => <LessonRow key={l.id} lesson={l} locked={m.isLocked} />)}
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
  quizButtonBusy: { opacity: 0.6 },
  quizError:   { ...Typography.bodySm, color: Colors.error },
  quizResult:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderRadius: Radius.sm },
  retryButton: { borderWidth: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
                 borderRadius: Radius.sm },

  lockedBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.xs,
                  paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.sm,
                  backgroundColor: Colors.surfaceVariant },
  lockedText:  { ...Typography.labelLg, color: Colors.onSurface },
  lockedDetail: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
