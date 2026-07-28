import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Trophy, Clock, TrendingUp, Gift } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useExamResult } from '@/features/academy/hooks';
import { formatClock } from '@/features/academy/constants';

/** X9 — Score breakdown. Per-subject + time + readiness delta + rewards. */
export default function ScoreBreakdown() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const result = useExamResult(attemptId);

  if (result.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Grading your mock…" /></SafeAreaView>;
  if (!result.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Result" showBack={false} /><StateView kind="error" title="Result not ready" message="Hang tight while we sync your score." actionLabel="Retry" onAction={() => result.refetch()} /></SafeAreaView>;

  const r = result.data;
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Mock result" showBack={false} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
          <Trophy size={28} color={Colors.gold} />
          <Text style={styles.heroPct}>{r.scorePct}%</Text>
          <Text style={styles.heroSub}>{r.correct} of {r.totalQuestions} correct · {r.unanswered} unanswered</Text>
        </LinearGradient>

        <View style={styles.metaRow}>
          <View style={[styles.metaCard, shadow1]}><Clock size={18} color={Colors.secondary} /><Text style={styles.metaVal}>{formatClock(r.timeSpentSec)}</Text><Text style={styles.metaLabel}>time spent</Text></View>
          <View style={[styles.metaCard, shadow1]}><TrendingUp size={18} color={Colors.teal} /><Text style={styles.metaVal}>+{r.readinessDelta}%</Text><Text style={styles.metaLabel}>readiness</Text></View>
          <View style={[styles.metaCard, shadow1]}><Gift size={18} color={Colors.gold} /><Text style={styles.metaVal}>+{r.pointsEarned}</Text><Text style={styles.metaLabel}>reward pts</Text></View>
        </View>

        <Text style={styles.section}>By subject</Text>
        {r.subjects.map((s) => (
          <View key={s.subjectId} style={[styles.subjCard, shadow1]}>
            <View style={styles.subjHead}>
              <Text style={styles.subjName}>{s.subjectName}</Text>
              <Text style={styles.subjPct}>{s.scorePct}%</Text>
            </View>
            <ProgressBar pct={s.scorePct} color={s.scorePct >= 50 ? Colors.teal : Colors.gold} style={{ marginTop: 6 }} />
            <Text style={styles.subjMeta}>{s.correct}/{s.total} correct</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Back to arena" onPress={() => router.replace('/learn/academy/exam')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center' },
  heroPct: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 52, lineHeight: 58 },
  heroSub: { ...Typography.bodyMd, color: Colors.inversePrimary },
  metaRow: { flexDirection: 'row', gap: Spacing.sm },
  metaCard: { flex: 1, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  metaVal: { ...Typography.titleMd, color: Colors.onSurface },
  metaLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  subjCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  subjHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subjName: { ...Typography.titleMd, color: Colors.onSurface },
  subjPct: { ...Typography.titleMd, color: Colors.onSurface },
  subjMeta: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
