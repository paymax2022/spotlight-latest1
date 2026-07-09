import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Icons from 'lucide-react-native';
import { Trophy, Medal, Swords, Award, ChevronRight, Users, School } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1, shadow3 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { formatPoints, formatDate } from '@/features/academy/constants';
import { useCompetitionProfile, useTournaments, useJoinTournament } from '@/features/academy/fees/hooks';
import type { Tournament } from '@/features/academy/fees/types';

const STATUS_META: Record<Tournament['status'], { label: string; color: string; bg: string }> = {
  upcoming: { label: 'Upcoming', color: Colors.secondary, bg: Colors.iconBgBlue },
  live:     { label: 'Live now', color: Colors.error,     bg: Colors.errorContainer },
  ended:    { label: 'Ended',    color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
};

/** SA-122 — Competition hub: student profile + cross-school tournaments. SF-4: never fee-gated. */
export default function CompetitionHub() {
  const profile = useCompetitionProfile();
  const tournaments = useTournaments();
  const join = useJoinTournament();

  if (profile.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Compete" />
        <StateView kind="loading" message="Loading competitions…" />
      </SafeAreaView>
    );
  }

  const p = profile.data;
  const list = tournaments.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Compete" subtitle="Cross-school arena" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={profile.isRefetching} onRefresh={() => { profile.refetch(); tournaments.refetch(); }} tintColor={Colors.primary} />}
      >
        {/* Profile card */}
        {p ? (
          <LinearGradient colors={Colors.gradientPurple} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.profile, shadow3]}>
            <View style={styles.profileTop}>
              <View>
                <Text style={styles.profileName}>{p.studentFirstName}</Text>
                <Text style={styles.profileSchool}>{p.schoolName} · {p.classLabel}</Text>
              </View>
              <View style={styles.rankBadge}>
                <Trophy size={16} color={Colors.gold} />
                <Text style={styles.rankText}>#{p.nationalRank ?? '—'}</Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <Stat label="Points" value={formatPoints(p.totalPoints)} />
              <Stat label="Badges" value={String(p.badgesEarned)} />
              <Stat label="Joined" value={String(p.tournamentsJoined)} />
            </View>
          </LinearGradient>
        ) : null}

        {/* Quick actions */}
        <View style={styles.grid}>
          <ActionTile icon={Medal} label="Leaderboards" onPress={() => router.push('/learn/academy/competition/leaderboard')} />
          <ActionTile icon={Swords} label="Challenges" onPress={() => router.push('/learn/academy/competition/challenge')} />
          <ActionTile icon={Award} label="Badges & rewards" onPress={() => router.push('/learn/academy/competition/badges')} />
        </View>

        {/* Tournaments */}
        <Text style={styles.section}>Tournaments</Text>
        {list.length ? list.map((t) => (
          <TournamentCard
            key={t.id}
            t={t}
            busy={join.isPending}
            onJoin={() => join.mutate(t.id, {
              onSuccess: () => Alert.alert('Joined', `You're in "${t.title}". Good luck!`),
              onError: (e) => Alert.alert('Could not join', (e as Error).message),
            })}
          />
        )) : (
          <StateView kind="empty" icon="Trophy" title="No tournaments" message="New cross-school tournaments appear here." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionTile({ icon: Icon, label, onPress }: { icon: typeof Medal; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.tile, shadow1]} onPress={onPress}>
      <View style={styles.tileIcon}><Icon size={20} color={Colors.primary} /></View>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

function TournamentCard({ t, onJoin, busy }: { t: Tournament; onJoin: () => void; busy: boolean }) {
  const meta = STATUS_META[t.status];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[t.icon] ?? Icons.Trophy;
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.cardTop}>
        <View style={styles.tIcon}><Icon size={20} color={Colors.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.tTitle} numberOfLines={1}>{t.title}</Text>
          <Text style={styles.tMeta}>{t.subject} · {t.scopeLabel}</Text>
        </View>
        <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
      </View>

      <View style={styles.tStats}>
        <View style={styles.tStat}><Users size={12} color={Colors.onSurfaceVariant} /><Text style={styles.tStatText}>{t.participantCount.toLocaleString('en-NG')}</Text></View>
        <View style={styles.tStat}><School size={12} color={Colors.onSurfaceVariant} /><Text style={styles.tStatText}>{t.schoolCount} schools</Text></View>
        <View style={styles.tStat}><Trophy size={12} color={Colors.gold} /><Text style={styles.tStatText}>{formatPoints(t.rewardPoints)}</Text></View>
      </View>
      {t.sponsor ? <Text style={styles.sponsor}>Sponsored by {t.sponsor}</Text> : null}
      <Text style={styles.dates}>{formatDate(t.startsAt)} – {formatDate(t.endsAt)}</Text>

      <View style={styles.cardActions}>
        {t.joined ? (
          <Pressable style={styles.viewBtn} onPress={() => router.push('/learn/academy/competition/leaderboard')}>
            <Text style={styles.viewText}>View standings</Text><ChevronRight size={14} color={Colors.secondary} />
          </Pressable>
        ) : t.status !== 'ended' ? (
          <Pressable style={styles.joinBtn} onPress={onJoin} disabled={busy}>
            <Text style={styles.joinText}>Join tournament</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.viewBtn} onPress={() => router.push('/learn/academy/competition/leaderboard')}>
            <Text style={styles.viewText}>Final results</Text><ChevronRight size={14} color={Colors.secondary} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  profile: { borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
  profileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileName: { ...Typography.headlineMd, color: Colors.onPrimary },
  profileSchool: { ...Typography.bodySm, color: Colors.inversePrimary },
  rankBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.backdropDark, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  rankText: { ...Typography.titleMd, color: Colors.onPrimary },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { ...Typography.titleMd, color: Colors.onPrimary },
  statLabel: { ...Typography.caption, color: Colors.inversePrimary },
  grid: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, minHeight: 92 },
  tileIcon: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  tileLabel: { ...Typography.labelSm, color: Colors.onSurface },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', marginTop: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.xs },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgGold },
  tTitle: { ...Typography.titleMd, color: Colors.onSurface },
  tMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  tStats: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xs },
  tStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tStatText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sponsor: { ...Typography.caption, color: Colors.secondary },
  dates: { ...Typography.caption, color: Colors.onSurfaceVariant },
  cardActions: { marginTop: Spacing.xs },
  joinBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 10, alignItems: 'center' },
  joinText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' },
  viewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10 },
  viewText: { ...Typography.labelMd, color: Colors.secondary, fontWeight: '700' },
});
