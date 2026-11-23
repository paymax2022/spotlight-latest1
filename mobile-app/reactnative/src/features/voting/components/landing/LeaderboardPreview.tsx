import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { ChevronRight, Trophy } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { shadow2 } from '@/constants/tokens';
import ContestStatusBadge from '../ContestStatusBadge';
import { formatVoteCount } from '../../utils/voteFormatters';
import { Stage } from './theme';
import type { Contest, LeaderboardEntry } from '../../types/voting.types';

interface Props {
  contest: Contest;
  entries: LeaderboardEntry[];
  onOpenContestant: (entry: LeaderboardEntry) => void;
  onViewFull: () => void;
}

const MEDALS: Record<number, { ring: string; ink: string; bg: string }> = {
  1: { ring: Stage.gold, ink: Stage.goldInk, bg: Stage.gold },
  2: { ring: '#CBD5E1', ink: '#1E293B', bg: '#E2E8F0' },
  3: { ring: '#D9A066', ink: '#3B2008', bg: '#CD7F32' },
};

/**
 * Section G. Only rendered when the contest still allows a public board — the
 * caller decides that, this card never invents a standings. Vote totals come
 * from the roster; a contest with counts hidden shows its rows without numbers.
 */
export default function LeaderboardPreview({ contest, entries, onOpenContestant, onViewFull }: Props) {
  const top = entries.filter((e) => e.rank > 0).slice(0, 3);
  if (top.length === 0) return null;

  return (
    <View style={[styles.card, shadow2]}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Trophy size={15} color={Stage.gold} strokeWidth={1.9} />
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {contest.title}
        </Text>
        <ContestStatusBadge status={contest.status} size="sm" />
      </View>

      {top.map((entry, index) => {
        const medal = MEDALS[entry.rank];
        const votes = typeof entry.contestant.votes === 'number' ? entry.contestant.votes : null;
        const name = entry.contestant.stageName ?? entry.contestant.name;
        return (
          <Pressable
            key={entry.contestant.id}
            onPress={() => onOpenContestant(entry)}
            style={({ pressed }) => [
              styles.row,
              index > 0 && styles.rowDivider,
              pressed && { opacity: 0.75 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Rank ${entry.rank}, ${name}${votes !== null ? `, ${votes} votes` : ''}`}
          >
            <View
              style={[
                styles.medal,
                medal ? { backgroundColor: medal.bg } : styles.medalPlain,
              ]}
            >
              <Text style={[styles.medalNum, { color: medal?.ink ?? Stage.white }]}>{entry.rank}</Text>
            </View>

            <View style={[styles.avatarRing, { borderColor: medal?.ring ?? 'rgba(255,255,255,0.22)' }]}>
              {/* The monogram sits underneath: a portrait whose URL fails leaves
                  the letter showing instead of an empty well. */}
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{name.charAt(0).toUpperCase()}</Text>
              </View>
              {entry.contestant.photo ? (
                <Image
                  source={{ uri: entry.contestant.photo }}
                  style={[styles.avatar, styles.avatarPhoto]}
                  contentFit="cover"
                  transition={160}
                  alt={name}
                />
              ) : null}
            </View>

            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              {entry.contestant.category || entry.contestant.state ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {[entry.contestant.category, entry.contestant.state].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>

            <View style={styles.voteBlock}>
              {votes !== null ? (
                <>
                  <Text style={styles.voteValue}>{formatVoteCount(votes)}</Text>
                  <Text style={styles.voteLabel}>VOTES</Text>
                </>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      <Pressable
        onPress={onViewFull}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.8 }]}
        accessibilityRole="button"
        accessibilityLabel="View the full leaderboard"
      >
        <Text style={styles.ctaText}>VIEW FULL LEADERBOARD</Text>
        <ChevronRight size={14} color={Stage.gold} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Stage.nightCard,
    borderRadius: Radius.xl,
    padding: 14,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: 'rgba(255,197,61,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...Typography.labelMd,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '700' as const,
    color: Stage.white,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  medal: {
    width: 26,
    height: 26,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalPlain: { backgroundColor: 'rgba(255,255,255,0.10)' },
  medalNum: {
    ...Typography.labelSm,
    fontSize: 11.5,
    lineHeight: 13,
    fontWeight: '800' as const,
  },
  avatarRing: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: 36, height: 36, borderRadius: Radius.full },
  avatarPhoto: { position: 'absolute', top: 1, left: 1 },
  avatarFallback: { backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...Typography.labelMd, color: Stage.white, fontWeight: '800' as const },
  info: { flex: 1, gap: 1 },
  name: {
    ...Typography.labelMd,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700' as const,
    color: Stage.white,
  },
  meta: { ...Typography.caption, fontSize: 10.5, lineHeight: 13, color: 'rgba(255,255,255,0.6)' },
  voteBlock: { alignItems: 'flex-end', minWidth: 46 },
  voteValue: {
    ...Typography.labelMd,
    fontSize: 13.5,
    lineHeight: 16,
    fontWeight: '800' as const,
    color: Stage.gold,
  },
  voteLabel: {
    ...Typography.caption,
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '700' as const,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.45)',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 10,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,197,61,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,197,61,0.38)',
  },
  ctaText: {
    ...Typography.labelSm,
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '800' as const,
    letterSpacing: 1.2,
    color: Stage.gold,
  },
});
