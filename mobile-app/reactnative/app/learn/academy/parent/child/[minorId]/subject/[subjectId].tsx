import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import Chip from '@/features/academy/components/Chip';
import { useChildSubject } from '@/features/academy/hooks';
import { MASTERY_META, formatDate } from '@/features/academy/constants';

/** P4 — Child subject detail: per-topic mastery + recent activity. */
export default function ChildSubjectDetailScreen() {
  const { minorId, subjectId } = useLocalSearchParams<{ minorId: string; subjectId: string }>();
  const detail = useChildSubject(minorId, subjectId);

  if (detail.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading subject…" /></SafeAreaView>;
  if (!detail.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Subject" /><StateView kind="error" title="Not found" /></SafeAreaView>;

  const d = detail.data;
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={d.subjectName} subtitle="Performance by topic" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.summary, shadow1]}>
          <View style={styles.rowBetween}><Text style={styles.summaryTitle}>Overall progress</Text><Text style={styles.summaryPct}>{d.progressPct}%</Text></View>
          <ProgressBar pct={d.progressPct} style={{ marginTop: Spacing.sm }} />
        </View>

        <Text style={styles.section}>Topics</Text>
        {d.topics.map((t) => {
          const meta = MASTERY_META[t.mastery];
          return (
            <View key={t.topicId} style={[styles.topicRow, shadow1]}>
              <View style={{ flex: 1 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.topicName}>{t.name}</Text>
                  <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
                </View>
                <ProgressBar pct={t.masteryPct} height={6} style={{ marginTop: 6 }} />
              </View>
            </View>
          );
        })}

        {d.recent.length ? (
          <>
            <Text style={styles.section}>Recent activity</Text>
            {d.recent.map((r) => (
              <View key={r.id} style={[styles.recentRow, shadow1]}>
                <Clock size={14} color={Colors.onSurfaceVariant} />
                <Text style={styles.recentLabel}>{r.label}</Text>
                {typeof r.scorePct === 'number' ? <Text style={styles.recentScore}>{r.scorePct}%</Text> : null}
                <Text style={styles.recentTs}>{formatDate(r.ts)}</Text>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  summary: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryTitle: { ...Typography.titleMd, color: Colors.onSurface },
  summaryPct: { ...Typography.titleLg, color: Colors.primary },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  topicRow: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  topicName: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, padding: Spacing.md },
  recentLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  recentScore: { ...Typography.labelMd, color: Colors.teal },
  recentTs: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
