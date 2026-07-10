import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Trophy, Gamepad2, HandCoins, MapPin, Target, Radio, PiggyBank, Flag, ChevronRight, ShieldCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCompetitions, useCompetition, useMeritLeaderboard } from '@/features/arena/hooks';
import Countdown from '@/features/arena/components/Countdown';
import { lastUpdatedLabel } from '@/features/arena/constants';

/**
 * S1 — Competition home / live MERIT leaderboard.
 * The Merit leaderboard here is the REAL ranking (NDC-1). Offline-tolerant:
 * cached reads show a "last updated" stamp. CTAs route to every rail + C0.
 */
export default function ArenaHomeScreen() {
  const params = useLocalSearchParams<{ competitionId?: string }>();
  const list = useCompetitions();

  // Default to the first live/open competition when none passed.
  const competitionId = useMemo(() => {
    if (params.competitionId) return params.competitionId;
    const items = list.data ?? [];
    return (items.find((c) => c.status === 'LIVE' || c.status === 'FINALE') ?? items[0])?.id ?? null;
  }, [params.competitionId, list.data]);

  const comp = useCompetition(competitionId);
  const board = useMeritLeaderboard(competitionId, comp.data?.status === 'LIVE' ? 15_000 : undefined);

  const refreshing = list.isRefetching || comp.isRefetching || board.isRefetching;
  const onRefresh = () => {
    list.refetch();
    comp.refetch();
    board.refetch();
  };

  if (list.isLoading || comp.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Arena" />
        <StateView kind="loading" message="Loading competition…" />
      </SafeAreaView>
    );
  }

  if (list.isError || !competitionId || !comp.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Arena" />
        <StateView
          kind={list.data && list.data.length === 0 ? 'empty' : 'error'}
          title={list.data && list.data.length === 0 ? 'No live competition' : 'Couldn’t load the Arena'}
          message={list.data && list.data.length === 0 ? 'Check back soon for the next Naija Driver contest.' : 'Check your connection and try again.'}
          actionLabel="Retry"
          onAction={onRefresh}
        />
      </SafeAreaView>
    );
  }

  const c = comp.data;
  const entries = board.data ?? [];

  const rails: { key: string; label: string; sub: string; Icon: typeof Gamepad2; go: () => void }[] = [
    { key: 'quiz', label: 'Are You a Naija Driver?', sub: 'Play-Along · 3 stages', Icon: Gamepad2, go: () => router.push({ pathname: '/arena/quiz', params: { competitionId } }) },
    { key: 'support', label: 'Back a Driver', sub: 'Fuel their journey', Icon: HandCoins, go: () => router.push({ pathname: '/arena/driver', params: { competitionId, contestantId: entries[0]?.contestantId ?? 'c1' } }) },
    { key: 'state', label: 'State Pride', sub: '36 states + FCT', Icon: MapPin, go: () => router.push({ pathname: '/arena/state-pride', params: { competitionId } }) },
    { key: 'predict', label: 'Predict the Champion', sub: 'Make your picks', Icon: Target, go: () => router.push({ pathname: '/arena/predict', params: { competitionId } }) },
    { key: 'finale', label: 'Live Finale', sub: 'Watch + gift live', Icon: Radio, go: () => router.push({ pathname: '/arena/finale', params: { competitionId } }) },
    { key: 'pot', label: 'Prize Pot', sub: 'Full transparency', Icon: PiggyBank, go: () => router.push({ pathname: '/arena/pot', params: { competitionId } }) },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={c.title}
        subtitle={c.season ?? undefined}
        rightSlot={
          <Pressable onPress={() => router.push({ pathname: '/arena/verify' })} hitSlop={8} accessibilityLabel="Verify a credential">
            <ShieldCheck size={20} color={Colors.primary} />
          </Pressable>
        }
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Countdown to next event */}
        <Countdown targetIso={c.nextEventAt} label={c.nextEventLabel ?? 'Next event'} />

        {/* Compete CTA (C0) */}
        <Pressable style={[styles.competeCta, shadow1]} onPress={() => router.push({ pathname: '/arena/enter', params: { competitionId } })}>
          <View style={styles.competeIcon}><Flag size={22} color={Colors.onPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.competeTitle}>Enter the Challenge</Text>
            <Text style={styles.competeSub}>Become a contestant · Certified Safe Driver</Text>
          </View>
          <ChevronRight size={20} color={Colors.onPrimary} />
        </Pressable>

        {/* Live Merit leaderboard — the REAL ranking (NDC-1) */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={styles.sectionTitleRow}>
              <Trophy size={18} color={Colors.gold} />
              <Text style={styles.sectionTitle}>Merit leaderboard</Text>
            </View>
            <Text style={styles.stamp}>{lastUpdatedLabel(entries[0] ? new Date().toISOString() : null)}</Text>
          </View>
          <Text style={styles.meritNote}>The official ranking — decided only by scores, never by money.</Text>

          {board.isLoading ? (
            <StateView kind="loading" compact />
          ) : entries.length === 0 ? (
            <StateView kind="empty" compact hideIcon title="No scores yet" message="Rankings appear once judging begins." />
          ) : (
            <View style={[styles.card, shadow1]}>
              {entries.slice(0, 10).map((e) => (
                <Pressable
                  key={e.contestantId}
                  style={styles.leaderRow}
                  onPress={() => router.push({ pathname: '/arena/driver', params: { competitionId, contestantId: e.contestantId } })}
                >
                  <Text style={[styles.rank, e.rank <= 3 && styles.rankTop]}>{e.rank}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverName} numberOfLines={1}>{e.displayName}</Text>
                    <Text style={styles.driverMeta}>{e.homeState}</Text>
                  </View>
                  <View style={styles.meritPill}>
                    <Text style={styles.meritPts}>{e.meritPoints}</Text>
                    <Text style={styles.meritUnit}>Merit</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Rails */}
        <View style={styles.railGrid}>
          {rails.map((r) => (
            <Pressable key={r.key} style={[styles.rail, shadow1]} onPress={r.go}>
              <View style={styles.railIcon}><r.Icon size={20} color={Colors.primary} /></View>
              <Text style={styles.railLabel} numberOfLines={1}>{r.label}</Text>
              <Text style={styles.railSub} numberOfLines={1}>{r.sub}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg },
  competeCta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primary, borderRadius: Radius.xl, padding: Spacing.lg,
  },
  competeIcon: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  competeTitle: { ...Typography.titleMd, color: Colors.onPrimary },
  competeSub: { ...Typography.labelSm, color: Colors.inversePrimary },
  section: { gap: Spacing.xs },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  stamp: { ...Typography.caption, color: Colors.onSurfaceVariant },
  meritNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.sm,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm },
  rank: { ...Typography.titleMd, color: Colors.onSurfaceVariant, width: 28, textAlign: 'center' },
  rankTop: { color: Colors.gold, fontWeight: '800' as const },
  driverName: { ...Typography.labelLg, color: Colors.onSurface },
  driverMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  meritPill: { alignItems: 'flex-end' },
  meritPts: { ...Typography.titleMd, color: Colors.primary },
  meritUnit: { ...Typography.caption, color: Colors.onSurfaceVariant },
  railGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  rail: {
    width: '47%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    padding: Spacing.md, gap: 2, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  railIcon: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  railLabel: { ...Typography.labelLg, color: Colors.onSurface },
  railSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
