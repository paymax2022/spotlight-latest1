// ── Film Academy — a lesson ──────────────────────────────────────────────────
// A NATIVE screen. Reads the lesson out of the curriculum already in the query
// cache rather than adding a per-lesson endpoint: the list is small, and one
// source of truth means the tick here and the tick on the course screen can
// never disagree.

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CircleCheck, Circle, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { getCurriculum, setLessonProgress, FILM_ACADEMY_LEARN_KEY } from '@/features/filmAcademy/api';
import { Lecture } from '@/features/filmAcademy/Lecture';
import { InlineVideo } from '@/features/filmAcademy/InlineVideo';
import { getErrorMessage } from '@/utils/errorMapper';

export default function FilmAcademyLessonScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: FILM_ACADEMY_LEARN_KEY,
    queryFn: getCurriculum,
  });

  const modules = data?.modules ?? [];
  const lesson = modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId) ?? null;
  const moduleTitle = modules.find((m) => m.lessons.some((l) => l.id === lessonId))?.title ?? '';

  const toggle = async () => {
    if (!lesson) return;
    setBusy(true);
    setError(null);
    try {
      await setLessonProgress(lesson.id, !lesson.completed);
      await queryClient.invalidateQueries({ queryKey: FILM_ACADEMY_LEARN_KEY });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };


  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{moduleTitle || 'Lesson'}</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        )}

        {!isLoading && !lesson && (
          <View style={styles.state}>
            <Text style={styles.stateText}>This lesson is no longer in your course.</Text>
            <Pressable onPress={() => router.replace('/film-academy/learn')} style={styles.retry}>
              <Text style={styles.retryText}>Back to my course</Text>
            </Pressable>
          </View>
        )}

        {!!lesson && (
          <>
            <Text style={styles.title}>{lesson.title}</Text>
            {!!lesson.estimated_minutes && (
              <View style={styles.metaRow}>
                <Clock size={14} color={Colors.onSurfaceVariant} />
                <Text style={styles.meta}>{lesson.estimated_minutes} min</Text>
                {lesson.is_required === false && <Text style={styles.meta}>· optional</Text>}
              </View>
            )}

            {!!lesson.description && <Text style={styles.body}>{lesson.description}</Text>}

            {/* The lecture itself. Rendered above the video links, because the
                reading is the lesson and the video supports it. */}
            {!!lesson.content_markdown && (
              <View style={styles.lecture}>
                <Lecture markdown={lesson.content_markdown} />
              </View>
            )}

            {/* Played in place. These used to call Linking.openURL, which handed
                the learner to the YouTube app or a new tab and lost their place
                in the course. */}
            {!!lesson.video_url && (
              <InlineVideo url={lesson.video_url} label="Watch the lesson" />
            )}

            {!!lesson.resource_url && (
              <InlineVideo
                url={lesson.resource_url}
                label={lesson.resource_label || 'Further material'}
              />
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              onPress={toggle}
              disabled={busy}
              style={[styles.markBtn, lesson.completed && styles.markBtnDone, busy && styles.markBtnBusy]}
            >
              {busy ? (
                <ActivityIndicator color={Colors.onSurface} />
              ) : (
                <>
                  {lesson.completed
                    ? <CircleCheck size={18} color={Colors.teal} />
                    : <Circle size={18} color={Colors.onSurface} />}
                  <Text style={styles.markBtnText}>
                    {lesson.completed ? 'Completed — tap to undo' : 'Mark as complete'}
                  </Text>
                </>
              )}
            </Pressable>
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
  headerTitle: { ...Typography.labelLg, color: Colors.onSurfaceVariant, flex: 1, textAlign: 'center' },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.sm },

  state:       { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  stateText:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },

  title:       { ...Typography.headlineMd, color: Colors.onSurface },
  metaRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta:        { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  body:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  lecture:     { marginTop: Spacing.sm, marginBottom: Spacing.sm },
  error:       { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.xs },

  markBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
                 backgroundColor: Colors.surface, borderRadius: Radius.md, paddingVertical: Spacing.md,
                 marginTop: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceVariant },
  markBtnDone: { borderColor: Colors.teal },
  markBtnBusy: { opacity: 0.6 },
  markBtnText: { ...Typography.labelLg, color: Colors.onSurface },
});
