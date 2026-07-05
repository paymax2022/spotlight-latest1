import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Zap, Coins, Flame, ListChecks, Trophy, Calendar, Gift, Award, ChevronRight, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import GameNonCashNotice from '@/features/connect/components/game-NonCashNotice';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useGamificationProfile } from '@/features/connect/gamification/hooks';

/** Progression hub (PRD §10.10 GM-01): XP, level, badges. */
export default function GamificationHomeScreen() {
  const q = useGamificationProfile();

  const tiles = [
    { icon: ListChecks, label: 'Missions', route: '/connect/gamification/missions' },
    { icon: Flame, label: 'Streaks', route: '/connect/gamification/streaks' },
    { icon: Trophy, label: 'Leaderboards', route: '/connect/gamification/leaderboards' },
    { icon: Calendar, label: 'Seasons', route: '/connect/gamification/seasons' },
    { icon: Gift, label: 'Rewards', route: '/connect/gamification/rewards' },
    { icon: Award, label: 'Badges', route: '/connect/gamification/badges' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rewards & progress" subtitle="Earn XP and coins for activity" />
      {q.isLoading ? (
        <StateView kind="loading" message="Loading your progress…" />
      ) : q.isError || !q.data ? (
        <StateView kind="error" title="Couldn't load progress" actionLabel="Retry" onAction={() => q.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Level card */}
          <View style={styles.levelCard}>
            <View style={styles.levelTop}>
              <View style={styles.levelBadge}>
                <Star size={16} color={Colors.onPrimary} strokeWidth={2.4} />
                <Text style={styles.levelNum}>Lv {q.data.level}</Text>
              </View>
              {q.data.rank ? <Text style={styles.rank}>{q.data.rank}</Text> : null}
            </View>
            <View style={styles.xpTrack}>
              <View style={[styles.xpFill, { width: `${Math.min(100, Math.round((q.data.xp / q.data.xpToNextLevel) * 100))}%` }]} />
            </View>
            <Text style={styles.xpText}>{q.data.xp.toLocaleString('en-NG')} / {q.data.xpToNextLevel.toLocaleString('en-NG')} XP to next level</Text>
          </View>

          {/* Currencies — explicitly non-cash */}
          <View style={styles.currencyRow}>
            <View style={styles.currencyCard}>
              <Zap size={20} color={ConnectColors.warn} strokeWidth={2.2} />
              <Text style={styles.currencyValue}>{q.data.totalXp.toLocaleString('en-NG')}</Text>
              <Text style={styles.currencyLabel}>Total XP</Text>
            </View>
            <View style={styles.currencyCard}>
              <Coins size={20} color={ConnectColors.warn} strokeWidth={2.2} />
              <Text style={styles.currencyValue}>{q.data.coins.toLocaleString('en-NG')}</Text>
              <Text style={styles.currencyLabel}>Coins</Text>
            </View>
            <View style={styles.currencyCard}>
              <Flame size={20} color={Colors.error} strokeWidth={2.2} />
              <Text style={styles.currencyValue}>{q.data.streakDays}</Text>
              <Text style={styles.currencyLabel}>Day streak</Text>
            </View>
          </View>

          <GameNonCashNotice />

          {/* Navigation grid */}
          <View style={styles.grid}>
            {tiles.map((t) => (
              <Pressable key={t.label} style={styles.tile} onPress={() => router.push(t.route as never)} accessibilityRole="button" accessibilityLabel={t.label}>
                <View style={styles.tileIcon}><t.icon size={22} color={ConnectColors.brand} strokeWidth={2.2} /></View>
                <Text style={styles.tileLabel}>{t.label}</Text>
                <ChevronRight size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.historyLink} onPress={() => router.push('/connect/gamification/xp-history')}>
            <Text style={styles.historyText}>View XP & coin history</Text>
            <ChevronRight size={16} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  levelCard: { backgroundColor: ConnectColors.brand, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm },
  levelTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  levelBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  levelNum: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '800' as const },
  rank: { ...Typography.labelMd, color: Colors.inversePrimary },
  xpTrack: { height: 10, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.onPrimary },
  xpText: { ...Typography.caption, color: Colors.inversePrimary },
  currencyRow: { flexDirection: 'row', gap: Spacing.sm },
  currencyCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md, alignItems: 'center', gap: 4 },
  currencyValue: { ...Typography.titleMd, color: Colors.onSurface },
  currencyLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  grid: { gap: Spacing.sm },
  tile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: ConnectColors.border, padding: Spacing.md },
  tileIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  historyLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.sm },
  historyText: { ...Typography.labelMd, color: Colors.secondary },
});
