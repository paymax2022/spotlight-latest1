import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Flame, Clock, Target, ChevronRight, SlidersHorizontal, FileText, AlertCircle, Award } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useChildDashboard } from '@/features/academy/hooks';
import { formatDate } from '@/features/academy/constants';

/** P3 — Child progress dashboard: engagement, mastery, exam readiness, alerts. */
export default function ChildDashboard() {
  const { minorId } = useLocalSearchParams<{ minorId: string }>();
  const dash = useChildDashboard(minorId);

  if (dash.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading dashboard…" /></SafeAreaView>;
  if (dash.isError) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Child" /><StateView kind="error" title="No active link" message={dash.error instanceof Error ? dash.error.message : 'Cannot load this child.'} actionLabel="Back" onAction={() => router.back()} /></SafeAreaView>;
  if (!dash.data) return null;

  const d = dash.data;
  const weeklyPct = Math.min(100, Math.round((d.weeklyMinutes / (d.weeklyGoalMinutes || 1)) * 100));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={d.displayName}
        subtitle={d.classCode}
        rightSlot={
          <Pressable onPress={() => router.push(`/learn/academy/parent/child/${minorId}/controls`)} hitSlop={8} accessibilityLabel="Usage controls">
            <SlidersHorizontal size={20} color={Colors.onSurface} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Readiness hero */}
        <LinearGradient colors={Colors.gradientCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
          <Text style={styles.heroKicker}>EXAM READINESS</Text>
          <Text style={styles.heroPct}>{d.readinessPct}%</Text>
          <ProgressBar pct={d.readinessPct} color={Colors.gold} trackColor="rgba(255,255,255,0.18)" style={{ marginTop: 6 }} />
        </LinearGradient>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, shadow1]}><Flame size={18} color={Colors.gold} /><Text style={styles.statNum}>{d.streakDays}</Text><Text style={styles.statLabel}>day streak</Text></View>
          <View style={[styles.statCard, shadow1]}><Target size={18} color={Colors.teal} /><Text style={styles.statNum}>{d.masteredObjectives}/{d.totalObjectives}</Text><Text style={styles.statLabel}>mastered</Text></View>
          <View style={[styles.statCard, shadow1]}><Clock size={18} color={Colors.secondary} /><Text style={styles.statNum}>{Math.round(d.weeklyMinutes / 60)}h</Text><Text style={styles.statLabel}>this week</Text></View>
        </View>

        {/* Weekly goal */}
        <View style={[styles.goalCard, shadow1]}>
          <View style={styles.rowBetween}>
            <Text style={styles.goalTitle}>Weekly study goal</Text>
            <Text style={styles.goalSub}>{d.weeklyMinutes}/{d.weeklyGoalMinutes} min</Text>
          </View>
          <ProgressBar pct={weeklyPct} style={{ marginTop: Spacing.sm }} />
        </View>

        {/* Alerts */}
        {d.alerts.length ? (
          <>
            <Text style={styles.section}>Alerts</Text>
            {d.alerts.map((a) => {
              const Icon = a.kind === 'achievement' ? Award : AlertCircle;
              const tint = a.kind === 'achievement' ? Colors.teal : a.kind === 'screen_time' ? Colors.error : Colors.onWarning;
              return (
                <View key={a.id} style={[styles.alertRow, shadow1]}>
                  <Icon size={16} color={tint} />
                  <Text style={styles.alertText}>{a.message}</Text>
                  <Text style={styles.alertTs}>{formatDate(a.ts)}</Text>
                </View>
              );
            })}
          </>
        ) : null}

        {/* Subjects */}
        <Text style={styles.section}>Subjects</Text>
        {d.subjects.map((s) => (
          <Pressable key={s.subjectId} style={[styles.subjRow, shadow1]} onPress={() => router.push(`/learn/academy/parent/child/${minorId}/subject/${s.subjectId}`)}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowBetween}><Text style={styles.subjName}>{s.name}</Text><Text style={styles.subjPct}>{s.progressPct}%</Text></View>
              <ProgressBar pct={s.progressPct} height={6} style={{ marginTop: 6 }} />
              <Text style={styles.subjMeta}>{s.masteredTopics}/{s.topicCount} topics mastered</Text>
            </View>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>
        ))}

        {/* Actions */}
        <View style={styles.actionRow}>
          <Pressable style={styles.action} onPress={() => router.push(`/learn/academy/parent/reports?minorId=${minorId}`)}>
            <FileText size={16} color={Colors.primary} /><Text style={styles.actionText}>Reports</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => router.push(`/learn/academy/parent/child/${minorId}/controls`)}>
            <SlidersHorizontal size={16} color={Colors.primary} /><Text style={styles.actionText}>Controls</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { borderRadius: Radius.xl, padding: Spacing.lg },
  heroKicker: { ...Typography.labelSm, color: Colors.gold, letterSpacing: 1, fontWeight: '700' },
  heroPct: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 44, lineHeight: 50 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  statCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', gap: 2 },
  statNum: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  goalCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalTitle: { ...Typography.titleMd, color: Colors.onSurface },
  goalSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.xs },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, padding: Spacing.md },
  alertText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  alertTs: { ...Typography.caption, color: Colors.onSurfaceVariant },
  subjRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  subjName: { ...Typography.labelLg, color: Colors.onSurface },
  subjPct: { ...Typography.labelMd, color: Colors.primary },
  subjMeta: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: 14 },
  actionText: { ...Typography.labelMd, color: Colors.primary },
});
