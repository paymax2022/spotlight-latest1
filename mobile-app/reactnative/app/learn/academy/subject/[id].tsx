import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock, ChevronRight, Target } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import OfflineBanner from '@/features/academy/components/OfflineBanner';
import Chip from '@/features/academy/components/Chip';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useSubject, useTopics } from '@/features/academy/hooks';
import { MASTERY_META } from '@/features/academy/constants';

/** L4 — Subject landing. Units/topics with mastery state and exam-relevance tags. */
export default function SubjectLanding() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const subject = useSubject(id);
  const topics = useTopics(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={subject.data?.name ?? 'Subject'} subtitle="Topics & mastery" />
      <OfflineBanner />
      {topics.isLoading ? (
        <StateView kind="loading" message="Loading topics…" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {subject.data ? (
            <View style={[styles.summary, shadow1]}>
              <Text style={styles.summaryPct}>{subject.data.progressPct}%</Text>
              <Text style={styles.summaryLabel}>{subject.data.masteredTopics} of {subject.data.topicCount} topics mastered</Text>
              <ProgressBar pct={subject.data.progressPct} style={{ marginTop: 8 }} />
            </View>
          ) : null}

          {topics.data?.map((t) => {
            const meta = MASTERY_META[t.mastery];
            return (
              <Pressable
                key={t.id}
                style={[styles.topicRow, shadow1, t.locked && styles.topicLocked]}
                onPress={() => !t.locked && router.push(`/learn/academy/topic/${t.id}`)}
                disabled={t.locked}
              >
                <View style={styles.topicLeft}>
                  <Text style={styles.topicName}>{t.order}. {t.name}</Text>
                  <View style={styles.chipRow}>
                    <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
                    {t.examRelevant ? <Chip label="Exam" color={Colors.onWarning} bg={Colors.iconBgGold} small /> : null}
                  </View>
                  <Text style={styles.topicMeta}>{t.lessonCount} lessons · {t.objectiveCount} objectives</Text>
                </View>
                {t.locked
                  ? <Lock size={18} color={Colors.onSurfaceVariant} />
                  : <ChevronRight size={18} color={Colors.onSurfaceVariant} />}
              </Pressable>
            );
          })}

          {!topics.data?.length ? (
            <StateView kind="empty" compact icon="Target" title="No topics yet" message="Topics for this subject are coming soon." />
          ) : null}

          <Pressable style={styles.masteryCta} onPress={() => topics.data?.[0] && router.push(`/learn/academy/mastery/${topics.data[0].id}`)}>
            <Target size={18} color={Colors.primary} />
            <Text style={styles.masteryCtaText}>Take a mastery check</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  summary: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, marginBottom: Spacing.sm },
  summaryPct: { ...Typography.headlineMd, color: Colors.primary },
  summaryLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  topicLocked: { opacity: 0.6 },
  topicLeft: { flex: 1, gap: 4 },
  topicName: { ...Typography.titleMd, color: Colors.onSurface },
  chipRow: { flexDirection: 'row', gap: 6 },
  topicMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  masteryCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.md, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.primary },
  masteryCtaText: { ...Typography.labelLg, color: Colors.primary },
});
