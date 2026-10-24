// A NATIVE screen. The enrolled learner's course: what to do next, progress, and the
// modules with their lessons and quizzes.
// "Locked" is a first-class state, not an error: an applicant who has not been
// approved or has not paid gets a reason and a way forward, because a blank
// screen here reads as a broken app. Individual modules lock the same way — as one
// row that says how to unlock them (see ModuleCard).

import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Lock, ClipboardList, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { getCurriculum, FILM_ACADEMY_LEARN_KEY } from '@/features/filmAcademy/api';
import { lockCopy } from '@/features/filmAcademy/lockCopy';
import { nextStep, courseProgress } from '@/features/filmAcademy/journey';
import { useStartQuiz } from '@/features/filmAcademy/useStartQuiz';
import ContinueCard from '@/features/filmAcademy/components/ContinueCard';
import ModuleCard from '@/features/filmAcademy/components/ModuleCard';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function FilmAcademyLearnScreen() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: FILM_ACADEMY_LEARN_KEY,
    queryFn: getCurriculum,
  });
  const quiz = useStartQuiz();

  // null = the learner has not touched any module yet, so the module they are currently
  // working in is open by default and the rest are collapsed.
  const [open, setOpen] = React.useState<Record<string, boolean> | null>(null);

  const modules = data?.modules ?? [];
  const step = nextStep(modules);
  const pct = data ? courseProgress(data) : 0;
  const lock = lockCopy(data?.reason);

  const defaultOpenId = step && step.type !== 'complete' ? modules[step.moduleIndex]?.id : modules[0]?.id;
  const isOpen = (id: string) => (open ? !!open[id] : id === defaultOpenId);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const base = prev ?? (defaultOpenId ? { [defaultOpenId]: true } : {});
      return { ...base, [id]: !base[id] };
    });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back} accessibilityLabel="Go back">
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

        {!isLoading && !error && data && !data.locked && (
          <>
            {step && (
              <ContinueCard
                step={step}
                onStartQuiz={quiz.start}
                starting={step.type === 'quiz' && quiz.startingId === step.quizId}
              />
            )}
            {!!quiz.error && step?.type === 'quiz' && quiz.error.quizId === step.quizId && (
              <Text style={styles.errorText}>{quiz.error.message}</Text>
            )}

            <View style={styles.progress}>
              <View style={styles.progressRow}>
                <Text style={styles.progressPct}>{pct}%</Text>
                <Text style={styles.progressMeta}>
                  {data.completedLessons} of {data.totalLessons} lesson{data.totalLessons === 1 ? '' : 's'} complete
                </Text>
              </View>
              <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
            </View>

            <View style={styles.tiles}>
              <Pressable onPress={() => router.push('/film-academy/assignments' as never)} style={styles.tile} accessibilityRole="button">
                <ClipboardList size={18} color={Colors.primary} />
                <Text style={styles.tileText}>Assignments</Text>
                <ChevronRight size={16} color={Colors.onSurfaceVariant} />
              </Pressable>
              <Pressable onPress={() => router.push('/film-academy/exams' as never)} style={styles.tile} accessibilityRole="button">
                <FileText size={18} color={Colors.primary} />
                <Text style={styles.tileText}>Exams</Text>
                <ChevronRight size={16} color={Colors.onSurfaceVariant} />
              </Pressable>
            </View>

            {modules.length === 0 && (
              <View style={styles.state}>
                <Text style={styles.stateText}>No lessons have been published yet. Check back soon.</Text>
              </View>
            )}

            {modules.map((m, i) => {
              const prev = i > 0 ? modules[i - 1] : null;
              const unlockHint = prev
                ? `Pass the Module ${i} quiz (${prev.quiz?.passMark ?? 85}%) to unlock`
                : 'Not available yet';
              return (
                <ModuleCard
                  key={m.id}
                  module={m}
                  number={i + 1}
                  expanded={isOpen(m.id)}
                  onToggle={() => toggle(m.id)}
                  unlockHint={unlockHint}
                  onStartQuiz={quiz.start}
                  startingQuizId={quiz.startingId}
                  quizError={m.quiz && quiz.error?.quizId === m.quiz.id ? quiz.error.message : null}
                />
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
  errorText:   { ...Typography.bodySm, color: Colors.error },

  progress:    { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm },
  progressRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  progressPct: { ...Typography.headlineMd, color: Colors.onSurface },
  progressMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  bar:         { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceVariant, overflow: 'hidden' },
  barFill:     { height: 6, borderRadius: 3, backgroundColor: Colors.primary },

  tiles:       { flexDirection: 'row', gap: Spacing.sm },
  tile:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md },
  tileText:    { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
});
