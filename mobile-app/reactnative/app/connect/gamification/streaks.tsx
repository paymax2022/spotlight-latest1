import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flame, Coins, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import GameNonCashNotice from '@/features/connect/components/game-NonCashNotice';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useStreak, useCheckInStreak } from '@/features/connect/gamification/hooks';

/** Daily check-in / streak reward (PRD §10.10 GM-03). Rewards are NON-CASH coins. */
export default function StreaksScreen() {
  const q = useStreak();
  const checkIn = useCheckInStreak();

  if (q.isLoading) return <SafeAreaView style={styles.safe}><ScreenHeader title="Daily streak" /><StateView kind="loading" message="Loading streak…" /></SafeAreaView>;
  if (q.isError || !q.data) return <SafeAreaView style={styles.safe}><ScreenHeader title="Daily streak" /><StateView kind="error" title="Couldn't load streak" actionLabel="Retry" onAction={() => q.refetch()} /></SafeAreaView>;
  const s = q.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Daily streak" subtitle="Check in every day" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.flameCircle}><Flame size={32} color={Colors.error} strokeWidth={2} /></View>
          <Text style={styles.streakNum}>{s.currentStreak}-day streak</Text>
          <Text style={styles.longest}>Longest: {s.longestStreak} days</Text>
        </View>

        <View style={styles.daysRow}>
          {s.days.map((d) => (
            <View key={d.day} style={[styles.dayCell, d.isToday && styles.dayToday, d.claimed && styles.dayClaimed]}>
              {d.claimed ? (
                <CircleCheck size={16} color={ConnectColors.ok} strokeWidth={2.4} />
              ) : (
                <>
                  <Coins size={14} color={d.isToday ? ConnectColors.brand : Colors.onSurfaceVariant} strokeWidth={2.2} />
                  <Text style={[styles.dayCoins, d.isToday && styles.dayCoinsToday]}>{d.rewardCoins}</Text>
                </>
              )}
              <Text style={styles.dayLabel}>Day {d.day}</Text>
            </View>
          ))}
        </View>

        <GameNonCashNotice />
      </ScrollView>

      <View style={styles.footer}>
        {s.checkedInToday ? (
          <View style={styles.doneRow}>
            <CircleCheck size={18} color={ConnectColors.ok} strokeWidth={2.2} />
            <Text style={styles.doneText}>Checked in today — come back tomorrow!</Text>
          </View>
        ) : (
          <PrimaryButton
            label={checkIn.isPending ? 'Checking in…' : `Check in for ${s.nextRewardCoins} coins`}
            onPress={() => checkIn.mutate()}
            loading={checkIn.isPending}
            disabled={checkIn.isPending}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: 4 },
  flameCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  streakNum: { ...Typography.titleLg, color: Colors.onSurface },
  longest: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  daysRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'center' },
  dayCell: { width: '21%', aspectRatio: 0.9, borderRadius: Radius.md, borderWidth: 1.5, borderColor: ConnectColors.border, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center', gap: 3 },
  dayToday: { borderColor: ConnectColors.brand, backgroundColor: Colors.iconBgPurple },
  dayClaimed: { backgroundColor: ConnectColors.okBg, borderColor: ConnectColors.okBg },
  dayCoins: { ...Typography.labelMd, color: Colors.onSurfaceVariant, fontWeight: '700' as const },
  dayCoinsToday: { color: ConnectColors.brand },
  dayLabel: { ...Typography.caption, color: Colors.onSurfaceVariant, fontSize: 10 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: ConnectColors.border },
  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  doneText: { ...Typography.labelMd, color: Colors.onSurface },
});
