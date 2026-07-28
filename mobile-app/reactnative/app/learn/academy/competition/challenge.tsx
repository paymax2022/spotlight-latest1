import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Zap, Swords, CalendarDays, Clock, Trophy, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { formatPoints, formatClock } from '@/features/academy/constants';
import { useCompetitionChallenges, usePlayChallenge } from '@/features/academy/fees/hooks';
import type { CompetitionChallenge, ChallengeMode } from '@/features/academy/fees/types';

const MODE_META: Record<ChallengeMode, { icon: typeof Zap; label: string; color: string; bg: string }> = {
  blitz: { icon: Zap,          label: 'Blitz',       color: Colors.onWarning, bg: Colors.iconBgGold },
  duel:  { icon: Swords,       label: 'Duel',        color: Colors.secondary, bg: Colors.iconBgBlue },
  daily: { icon: CalendarDays, label: 'Daily',       color: Colors.teal,      bg: Colors.iconBgTeal },
};

/** SA-123 — Challenge mode: blitz / duel / daily rounds. Scoring is server-authoritative. */
export default function CompetitionChallengeScreen() {
  const challenges = useCompetitionChallenges();
  const play = usePlayChallenge();

  if (challenges.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Challenges" />
        <StateView kind="loading" message="Loading challenges…" />
      </SafeAreaView>
    );
  }

  const list = challenges.data ?? [];

  const onPlay = (c: CompetitionChallenge) => {
    play.mutate(c.id, {
      onSuccess: (res) => {
        const bonus = res.badgeUnlocked ? `\nBadge unlocked: ${res.badgeUnlocked}!` : '';
        const rankLine = res.rank ? `\nRank this round: #${res.rank}` : '';
        Alert.alert(
          `${res.scorePct}% · ${res.correct}/${res.total}`,
          `You earned ${formatPoints(res.pointsEarned)}.${rankLine}${bonus}`,
        );
      },
      onError: (e) => Alert.alert('Could not start', (e as Error).message),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Challenges" subtitle="Quick rounds vs other schools" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {list.length ? list.map((c) => <ChallengeCard key={c.id} c={c} onPlay={() => onPlay(c)} busy={play.isPending} />) : (
          <StateView kind="empty" icon="Swords" title="No challenges" message="Come back for new rounds." compact />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ChallengeCard({ c, onPlay, busy }: { c: CompetitionChallenge; onPlay: () => void; busy: boolean }) {
  const meta = MODE_META[c.mode];
  const Icon = meta.icon;
  const done = c.status === 'completed';
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: meta.bg }]}><Icon size={20} color={meta.color} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{c.title}</Text>
          <Text style={styles.subject}>{c.subject}{c.opponent ? ` · vs ${c.opponent}` : ''}</Text>
        </View>
        <Chip label={meta.label} color={meta.color} bg={meta.bg} small />
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.statText}>{c.questionCount} Qs</Text></View>
        <View style={styles.stat}><Clock size={12} color={Colors.onSurfaceVariant} /><Text style={styles.statText}>{formatClock(c.durationSec)}</Text></View>
        <View style={styles.stat}><Trophy size={12} color={Colors.gold} /><Text style={styles.statText}>{formatPoints(c.rewardPoints)}</Text></View>
      </View>

      {done ? (
        <View style={styles.doneRow}><CheckCircle2 size={16} color={Colors.teal} /><Text style={styles.doneText}>Completed today</Text></View>
      ) : (
        <Pressable style={styles.playBtn} onPress={onPlay} disabled={busy}>
          <Text style={styles.playText}>{busy ? 'Starting…' : 'Play now'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  subject: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  stats: { flexDirection: 'row', gap: Spacing.md },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  playBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 10, alignItems: 'center' },
  playText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneText: { ...Typography.labelMd, color: Colors.teal, fontWeight: '700' },
});
