import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flame, Sparkles, Check, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { GraceCountdown, DisclosureCard } from '@/features/referral/components';
import { useStreak } from '@/features/referral/gamification/hooks';

// M-GAM-03 — Streaks & milestones. Consecutive activity rewards (NON-CASH points).
export default function StreaksScreen() {
  const { data, isLoading, isError, refetch } = useStreak();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Streaks & milestones" />
      {isLoading ? (
        <StateView kind="loading" message="Loading streak…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Current streak */}
          <View style={styles.streakCard}>
            <View style={styles.flameWrap}><Flame size={34} color={Colors.gold} strokeWidth={2} /></View>
            <Text style={styles.streakValue}>{data.current}</Text>
            <Text style={styles.streakUnit}>{data.unit === 'week' ? 'week' : 'day'} streak</Text>
            <Text style={styles.streakLongest}>Longest: {data.longest} {data.unit}s</Text>
          </View>

          {data.expiresAt ? (
            <GraceCountdown expiresAt={data.expiresAt} />
          ) : null}

          <DisclosureCard
            tone="info"
            title="Keep it real"
            body="Streaks grow from genuine activity in your referral network. Milestone rewards are non-cash points — they recognise consistency, not recruitment."
          />

          <Text style={styles.sectionTitle}>Milestones</Text>
          <View style={styles.milestones}>
            {data.milestones.map((m, i) => (
              <View key={m.id} style={[styles.milestone, i < data.milestones.length - 1 && styles.mBorder]}>
                <View style={[styles.mIcon, m.reached ? styles.mIconDone : styles.mIconPending]}>
                  {m.reached ? <Check size={15} color={Colors.white} strokeWidth={3} /> : <Lock size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />}
                </View>
                <View style={styles.mBody}>
                  <Text style={[styles.mLabel, !m.reached && styles.mLabelPending]}>{m.label}</Text>
                  <Text style={styles.mSub}>At {m.atStreak} {data.unit}s</Text>
                </View>
                <View style={styles.mReward}>
                  <Sparkles size={13} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.mRewardText}>{m.points} pts</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  streakCard: { alignItems: 'center', gap: 2, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.lg },
  flameWrap: { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  streakValue: { ...Typography.displayLg, color: Colors.onSurface, fontWeight: '800' as const },
  streakUnit: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  streakLongest: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  milestones: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  milestone: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  mBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  mIcon: { width: 30, height: 30, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  mIconDone: { backgroundColor: Colors.primary },
  mIconPending: { backgroundColor: Colors.surfaceContainerHigh },
  mBody: { flex: 1 },
  mLabel: { ...Typography.labelMd, color: Colors.onSurface },
  mLabelPending: { color: Colors.onSurfaceVariant },
  mSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  mReward: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgBlue, paddingHorizontal: Spacing.sm, paddingVertical: 5, borderRadius: Radius.full },
  mRewardText: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const },
});
