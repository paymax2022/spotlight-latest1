// A NATIVE screen: the learner's sequential topic path.
//
// Every state on this screen comes from the server (deriveTopicState against the
// mastery ledger, publication gates, holds and the approved question pool). The
// app does not infer that a topic is unlocked from local progress — a locked row
// carries the server's own blocker copy so the learner knows exactly what is
// outstanding. Mastery is exact integer arithmetic on the server: a topic opens
// its successor only at >= 85%, and a hold keeps a passed topic short of MASTERED.

import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Lock, CircleCheck, Clock, AlertTriangle, BookOpen,
} from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { getTopicPath, FILM_ACADEMY_PATH_KEY } from '@/features/filmAcademy/api';
import { useMasteryEvents } from '@/features/filmAcademy/useMasteryEvents';
import { topicStateColor, topicStateLabel } from '@/features/filmAcademy/topicState';
import type { FilmTopicPathCourse, FilmTopicPathItem } from '@/features/filmAcademy/types';
import { HomeMenuButton } from '@/components/HomeMenu';

function TopicRow({ topic }: { topic: FilmTopicPathItem }) {
  const color = topicStateColor(topic.state);
  const locked = topic.state === 'LOCKED';
  return (
    <Pressable
      onPress={() => router.push(`/film-academy/topic/${topic.topicId}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`${topic.title}, ${topicStateLabel(topic.state)}${
        topic.blockerMessage ? `. ${topic.blockerMessage}` : ''
      }`}
      style={styles.topicRow}
    >
      <View style={[styles.stateDot, { backgroundColor: color + '20' }]}>
        {topic.state === 'MASTERED' ? (
          <CircleCheck size={16} color={color} />
        ) : locked ? (
          <Lock size={15} color={color} />
        ) : topic.state === 'REMEDIATION_REQUIRED' ? (
          <AlertTriangle size={15} color={color} />
        ) : (
          <BookOpen size={15} color={color} />
        )}
      </View>

      <View style={styles.topicBody}>
        <Text style={[styles.topicTitle, locked && styles.topicTitleLocked]} numberOfLines={2}>
          {topic.title}
        </Text>
        <View style={styles.topicMetaRow}>
          <Text style={[styles.stateLabel, { color }]}>{topicStateLabel(topic.state)}</Text>
          {topic.pilot ? (
            <Text style={styles.pilotTag}>Pilot · not yet reviewed</Text>
          ) : null}
          <Text style={styles.topicMeta}>
            · {topic.approvedQuestionCount}/{Math.max(20, topic.drawCount)} questions approved
          </Text>
        </View>
        {!!topic.blockerMessage && (
          <Text style={styles.blocker} numberOfLines={2}>{topic.blockerMessage}</Text>
        )}
        {topic.openHolds.length > 0 && (
          <Text style={styles.hold} numberOfLines={2}>
            Hold: {topic.openHolds[0].reason}
          </Text>
        )}
      </View>

      {topic.bestScore !== null && (
        <Text style={[styles.score, { color }]}>{Math.round(topic.bestScore)}%</Text>
      )}
      <ChevronRight size={16} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

function CourseCard({ course }: { course: FilmTopicPathCourse }) {
  const mastered = course.topics.filter((t) => t.state === 'MASTERED').length;
  return (
    <View style={styles.card}>
      <Text style={styles.stageLabel}>{course.stageLabel}</Text>
      <Text style={styles.courseTitle}>{course.title}</Text>
      <Text style={styles.courseMeta}>
        {mastered} of {course.topics.length} topics mastered
      </Text>
      <View style={styles.topicList}>
        {course.topics.map((topic) => <TopicRow key={topic.topicId} topic={topic} />)}
      </View>
    </View>
  );
}

export default function FilmAcademyPathScreen() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: FILM_ACADEMY_PATH_KEY,
    queryFn: getTopicPath,
  });

  useMasteryEvents(!isLoading && !error, data?.eventsCursor ?? 0);

  const summary = data?.summary;
  const pct = summary?.percentMastered ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/film-academy')} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Topic path</Text>
        <HomeMenuButton />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />
        }
      >
        {isLoading && (
          <View style={styles.state}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateText}>Loading your topic path…</Text>
          </View>
        )}

        {!!error && !isLoading && (
          <View style={styles.state}>
            <Text style={styles.stateText}>
              The topic path is not available right now. Your academy may still be
              reviewing the curriculum.
            </Text>
            <Pressable onPress={() => refetch()} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !error && !!summary && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryPct}>{Math.round(pct)}%</Text>
            <Text style={styles.summaryMeta}>
              {summary.masteredTopics} of {summary.totalTopics} topics mastered
            </Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, pct))}%` }]} />
            </View>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{summary.publishedTopics}</Text>
                <Text style={styles.summaryLabel}>published</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{summary.inProgressTopics}</Text>
                <Text style={styles.summaryLabel}>in progress</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, summary.remediationTopics > 0 && { color: Colors.error }]}>
                  {summary.remediationTopics}
                </Text>
                <Text style={styles.summaryLabel}>to retake</Text>
              </View>
            </View>
            <Text style={styles.rule}>
              Each topic must be passed at 85% or higher before the next one opens.
            </Text>
          </View>
        )}

        {!isLoading && !error && data?.courses.length === 0 && (
          <View style={styles.state}>
            <Clock size={26} color={Colors.onSurfaceVariant} />
            <Text style={styles.stateText}>
              No topics have been imported yet. Your academy will open the path once
              the curriculum has been reviewed and published.
            </Text>
          </View>
        )}

        {!isLoading && !error && data?.courses.map((course) => (
          <CourseCard key={course.courseId} course={course} />
        ))}
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
  retry:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
                 borderRadius: Radius.md, backgroundColor: Colors.surfaceVariant },
  retryText:   { ...Typography.labelLg, color: Colors.onSurface },

  summaryCard: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg,
                 gap: Spacing.xs },
  summaryPct:  { ...Typography.headlineLg, color: Colors.onSurface },
  summaryMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  bar:         { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceVariant,
                 overflow: 'hidden', marginTop: Spacing.xs },
  barFill:     { height: 6, borderRadius: 3, backgroundColor: Colors.teal },
  summaryRow:  { flexDirection: 'row', marginTop: Spacing.md, gap: Spacing.lg },
  summaryItem: { flex: 1, gap: 2 },
  summaryValue:{ ...Typography.titleMd, color: Colors.onSurface },
  summaryLabel:{ ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rule:        { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },

  card:        { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg,
                 gap: 2 },
  stageLabel:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'uppercase',
                 letterSpacing: 0.5 },
  courseTitle: { ...Typography.titleMd, color: Colors.onSurface },
  courseMeta:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  topicList:   { gap: 0 },

  topicRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
                 paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceVariant },
  stateDot:    { width: 30, height: 30, borderRadius: Radius.sm, alignItems: 'center',
                 justifyContent: 'center' },
  topicBody:   { flex: 1, gap: 2 },
  topicTitle:  { ...Typography.bodyMd, color: Colors.onSurface },
  topicTitleLocked: { color: Colors.onSurfaceVariant },
  topicMetaRow:{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  stateLabel:  { ...Typography.labelSm, fontWeight: '600' },
  pilotTag:    { ...Typography.labelSm, color: Colors.onWarning, fontWeight: '700' },
  topicMeta:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  blocker:     { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  hold:        { ...Typography.labelSm, color: Colors.error },
  score:       { ...Typography.labelLg, fontWeight: '700' },
});
