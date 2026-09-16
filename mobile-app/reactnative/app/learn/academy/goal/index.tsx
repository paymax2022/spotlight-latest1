import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flame, Snowflake, Target, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ProgressBar from '@/features/academy/components/ProgressBar';
import { useDailyGoal } from '@/features/academy/hooks';
import type { StreakDay } from '@/features/academy/types';

/** L2 — Daily goal & streak: goal progress, 5-week streak calendar, freeze tokens. */
export default function DailyGoalScreen() {
  const goal = useDailyGoal();

  if (goal.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading your goal…" /></SafeAreaView>;
  if (!goal.data) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Daily goal" /><StateView kind="error" title="Couldn’t load goal" /></SafeAreaView>;

  const g = goal.data;
  const pct = Math.min(100, Math.round((g.doneMinutes / (g.goalMinutes || 1)) * 100));
  const goalMet = g.doneMinutes >= g.goalMinutes;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Daily goal & streak" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Streak hero */}
        <LinearGradient colors={Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow3]}>
          <Flame size={28} color={Colors.gold} />
          <Text style={styles.heroNum}>{g.streakDays}</Text>
          <Text style={styles.heroLabel}>day streak</Text>
          <View style={styles.freezeRow}>
            <Snowflake size={14} color={Colors.inversePrimary} />
            <Text style={styles.freezeText}>{g.freezeTokens} freeze token{g.freezeTokens === 1 ? '' : 's'} — protect your streak on a missed day</Text>
          </View>
        </LinearGradient>

        {/* Today's goal */}
        <View style={[styles.goalCard, shadow1]}>
          <View style={styles.goalTop}>
            <View style={styles.goalIcon}><Target size={20} color={Colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.goalTitle}>Today’s goal</Text>
              <Text style={styles.goalSub}>{g.doneMinutes} of {g.goalMinutes} minutes</Text>
            </View>
            {goalMet ? <View style={styles.metPill}><Check size={14} color={Colors.teal} strokeWidth={3} /><Text style={styles.metText}>Met</Text></View> : null}
          </View>
          <ProgressBar pct={pct} color={goalMet ? Colors.teal : Colors.primary} style={{ marginTop: Spacing.sm }} />
        </View>

        {/* Streak calendar */}
        <Text style={styles.section}>Last 5 weeks</Text>
        <View style={[styles.calCard, shadow1]}>
          <View style={styles.grid}>
            {g.calendar.map((d) => <DayCell key={d.date} day={d} />)}
          </View>
          <View style={styles.legend}>
            <Legend color={Colors.teal} label="Studied" />
            <Legend color={Colors.secondary} label="Frozen" />
            <Legend color={Colors.errorContainer} label="Missed" border={Colors.error} />
            <Legend color={Colors.surfaceContainerHigh} label="Upcoming" />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DayCell({ day }: { day: StreakDay }) {
  const style = {
    studied: { backgroundColor: Colors.teal },
    frozen: { backgroundColor: Colors.secondary },
    missed: { backgroundColor: Colors.errorContainer, borderWidth: 1, borderColor: Colors.error },
    today: { backgroundColor: Colors.gold },
    future: { backgroundColor: Colors.surfaceContainerHigh },
  }[day.state];
  return (
    <View style={[styles.cell, style]}>
      {day.state === 'frozen' ? <Snowflake size={12} color={Colors.white} /> : null}
      {day.state === 'today' ? <Flame size={12} color={Colors.white} /> : null}
    </View>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }, border ? { borderWidth: 1, borderColor: border } : null]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: 2 },
  heroNum: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 52, letterSpacing: -1.04, lineHeight: 58 },
  heroLabel: { ...Typography.labelLg, color: Colors.inversePrimary },
  freezeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm, paddingHorizontal: Spacing.md },
  freezeText: { ...Typography.labelSm, color: Colors.inversePrimary, flex: 1 },
  goalCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  goalTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  goalIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  goalTitle: { ...Typography.titleMd, color: Colors.onSurface },
  goalSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  metPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  metText: { ...Typography.labelSm, color: Colors.teal, fontWeight: '700' },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.sm },
  calCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between' },
  cell: { width: 36, height: 36, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 4 },
  legendText: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
