import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowUpRight, CalendarDays, Users } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { shadow2 } from '@/constants/tokens';
import ContestStatusBadge from '../ContestStatusBadge';
import { formatVoteCount } from '../../utils/voteFormatters';
import { Stage, contestLabel, deadlineLabel } from './theme';
import type { Contest } from '../../types/voting.types';

interface Props {
  contest: Contest;
  onPress: () => void;
  width?: number;
}

/**
 * Section C's poster. The artwork is the card: the contest's own banner runs to
 * the edges, the night gradient gives the title a floor, and the only chrome on
 * top is the status pill and the contest logo. Everything numeric here comes
 * from the contest — a field the backend left out is a row that does not draw.
 */
export default function LiveContestCard({ contest, onPress, width = 252 }: Props) {
  const label = contestLabel(contest);
  const deadline = deadlineLabel(contest.endsAt);
  const votes = typeof contest.totalVotes === 'number' && contest.totalVotes > 0 ? contest.totalVotes : null;
  const hasStats = contest.contestantCount > 0 || votes !== null || !!deadline;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, shadow2, { width }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${contest.title}, ${contest.contestantCount} contestants`}
    >
      {contest.bannerImage ? (
        <Image
          source={{ uri: contest.bannerImage }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={220}
          cachePolicy="disk"
          alt={contest.title}
        />
      ) : (
        <LinearGradient colors={[Stage.nightSoft, Stage.nightDeep]} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient
        colors={['rgba(12,3,25,0.05)', 'rgba(12,3,25,0.55)', 'rgba(12,3,25,0.95)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.topRow}>
        <ContestStatusBadge status={contest.status} size="sm" />
        {contest.logoImage ? (
          <Image source={{ uri: contest.logoImage }} style={styles.logo} contentFit="cover" />
        ) : null}
      </View>

      <View style={styles.body}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <Text style={styles.title} numberOfLines={2}>
          {contest.title}
        </Text>

        {hasStats ? (
          <View style={styles.stats}>
            {contest.contestantCount > 0 ? (
              <View style={styles.stat}>
                <Users size={11} color="rgba(255,255,255,0.66)" strokeWidth={2} />
                <Text style={styles.statText}>{contest.contestantCount}</Text>
              </View>
            ) : null}
            {votes !== null ? (
              <View style={styles.stat}>
                <Text style={styles.statVotes}>{formatVoteCount(votes)}</Text>
                <Text style={styles.statText}>votes</Text>
              </View>
            ) : null}
            {deadline ? (
              <View style={styles.stat}>
                <CalendarDays size={11} color="rgba(255,255,255,0.66)" strokeWidth={2} />
                <Text style={styles.statText}>{deadline}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.cta}>
          <Text style={styles.ctaText}>VIEW CONTEST</Text>
          <View style={styles.ctaArrow}>
            <ArrowUpRight size={12} color={Stage.goldInk} strokeWidth={2.6} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 322,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    backgroundColor: Stage.night,
    justifyContent: 'space-between',
  },
  pressed: { opacity: 0.9 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 12,
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: Stage.white,
  },
  body: { padding: 14, gap: 4 },
  label: {
    ...Typography.labelSm,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '800' as const,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Stage.gold,
  },
  title: {
    ...Typography.titleMd,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800' as const,
    letterSpacing: -0.4,
    color: Stage.white,
  },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statVotes: { ...Typography.labelSm, fontSize: 11, fontWeight: '800' as const, color: Stage.gold },
  statText: { ...Typography.caption, fontSize: 10.5, color: 'rgba(255,255,255,0.68)' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.22)',
  },
  ctaText: {
    ...Typography.labelSm,
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '800' as const,
    letterSpacing: 1.1,
    color: Stage.white,
  },
  ctaArrow: {
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    backgroundColor: Stage.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
