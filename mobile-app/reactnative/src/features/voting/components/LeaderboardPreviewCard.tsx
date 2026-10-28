import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, Crown, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { VotingColors } from '../constants/voting.constants';
import { formatVoteCount } from '../utils/voteFormatters';
import ContestStatusBadge from './ContestStatusBadge';
import type { Contest, LeaderboardEntry } from '../types/voting.types';

interface Props {
  contest?: Contest;
  entries: LeaderboardEntry[];
  onOpenContestant: (contestantId: string) => void;
  onOpenLeaderboard: () => void;
}

const MEDAL: Record<number, string> = {
  1: VotingColors.rankGold,
  2: VotingColors.rankSilver,
  3: VotingColors.rankBronze,
};

function Contender({ entry, onPress }: { entry: LeaderboardEntry; onPress: () => void }) {
  const { contestant, rank } = entry;
  const first = rank === 1;
  const size = first ? 72 : 56;
  const ring = MEDAL[rank] ?? Colors.outlineVariant;
  const name = contestant.stageName ?? contestant.name;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.contender, first && styles.contenderFirst, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${name}, rank ${rank}, ${formatVoteCount(contestant.votes)} votes`}
    >
      {first ? <Crown size={18} color={ring} fill={ring} strokeWidth={0} style={styles.crown} /> : null}
      <View style={[styles.ring, { borderColor: ring, width: size + 8, height: size + 8, borderRadius: (size + 8) / 2 }]}>
        {contestant.photo ? (
          <Image source={{ uri: contestant.photo }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        ) : (
          <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={styles.initial}>{name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.medal, { backgroundColor: ring }]}>
          <Text style={styles.medalText}>{rank}</Text>
        </View>
      </View>
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
      <Text style={styles.votes}>{formatVoteCount(contestant.votes)}</Text>
      <Text style={styles.votesLabel}>votes</Text>
    </Pressable>
  );
}

export default function LeaderboardPreviewCard({ contest, entries, onOpenContestant, onOpenLeaderboard }: Props) {
  const byRank = (r: number) => entries.find((e) => e.rank === r);
  // Podium order: 2nd, 1st, 3rd — the leader sits in the middle.
  const podium = [byRank(2), byRank(1), byRank(3)].filter((e): e is LeaderboardEntry => !!e);
  const shown = podium.length ? podium : entries.slice(0, 3);

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.banner}>
        {contest?.bannerImage ? (
          <Image source={{ uri: contest.bannerImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.bannerFallback]} />
        )}
        <LinearGradient colors={['rgba(11,28,48,0.05)', 'rgba(11,28,48,0.88)']} style={StyleSheet.absoluteFill} />

        <View style={styles.bannerTop}>
          {contest?.logoImage ? (
            <Image source={{ uri: contest.logoImage }} style={styles.logo} resizeMode="cover" accessibilityLabel={`${contest.title} logo`} />
          ) : <View />}
          <ContestStatusBadge status={contest?.status ?? 'LIVE'} size="sm" />
        </View>

        <View style={styles.bannerBottom}>
          <View style={styles.titleRow}>
            <Trophy size={16} color={Colors.white} strokeWidth={1.8} />
            <Text style={styles.bannerTitle} numberOfLines={2}>{contest?.title ?? 'Live contest'}</Text>
          </View>
          {contest ? (
            <Text style={styles.bannerMeta}>
              {contest.contestantCount} contestants · {formatVoteCount(contest.totalVotes)} total votes
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.podium}>
        {shown.map((entry) => (
          <Contender key={entry.contestant.id} entry={entry} onPress={() => onOpenContestant(entry.contestant.id)} />
        ))}
      </View>

      <Pressable onPress={onOpenLeaderboard} style={styles.seeAll} accessibilityRole="button">
        <Text style={styles.seeAllText}>See full leaderboard</Text>
        <ChevronRight size={14} color={Colors.primary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden',
  },
  banner: { height: 148, justifyContent: 'space-between', padding: Spacing.md },
  bannerFallback: { backgroundColor: Colors.primary },
  bannerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  logo: { width: 40, height: 40, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.white, backgroundColor: Colors.white },
  bannerBottom: { gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  bannerTitle: { ...Typography.titleMd, color: Colors.white, flex: 1 },
  bannerMeta: { ...Typography.labelSm, color: 'rgba(255,255,255,0.82)' },

  podium: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around',
    gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.lg, paddingBottom: Spacing.sm,
  },
  contender: { flex: 1, alignItems: 'center', maxWidth: 120 },
  contenderFirst: { marginBottom: Spacing.sm },
  pressed: { opacity: 0.78 },
  crown: { marginBottom: 2 },
  ring: { borderWidth: 2.5, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  placeholder: { backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  initial: { ...Typography.titleMd, color: Colors.onPrimaryContainer },
  medal: {
    position: 'absolute', bottom: -6, alignSelf: 'center', minWidth: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.surfaceContainerLowest,
  },
  medalText: { ...Typography.caption, color: Colors.white, fontWeight: '700' as const },
  name: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '600' as const, marginTop: Spacing.xs, textAlign: 'center' },
  votes: { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' as const },
  votesLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },

  seeAll: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh,
  },
  seeAllText: { ...Typography.labelMd, color: Colors.primary },
});
