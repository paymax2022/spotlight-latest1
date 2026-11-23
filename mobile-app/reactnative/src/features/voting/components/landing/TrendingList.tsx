import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, Flame, Users } from 'lucide-react-native';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import { formatVoteCount } from '../../utils/voteFormatters';
import { Stage, statusKicker } from './theme';
import type { Contest } from '../../types/voting.types';

interface Props {
  contests: Contest[];
  onPress: (contest: Contest) => void;
}

/**
 * Section F. An ordered list — so it is numbered, and the numbers are the whole
 * point: 01 is where the votes are going. Order is the backend's own tally
 * (total votes, then roster size, then recency); no engagement figure is shown
 * that the API did not send.
 */
export default function TrendingList({ contests, onPress }: Props) {
  return (
    <View style={[styles.card, shadow1]}>
      {contests.map((contest, index) => {
        const votes = typeof contest.totalVotes === 'number' && contest.totalVotes > 0 ? contest.totalVotes : null;
        return (
          <Pressable
            key={contest.id}
            onPress={() => onPress(contest)}
            style={({ pressed }) => [
              styles.row,
              index < contests.length - 1 && styles.rowDivider,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${contest.title}. ${votes ? `${votes} votes.` : ''}`}
          >
            <Text style={styles.rank}>{String(index + 1).padStart(2, '0')}</Text>

            <View style={styles.thumb}>
              {contest.bannerImage ? (
                <Image
                  source={{ uri: contest.bannerImage }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={160}
                />
              ) : (
                <LinearGradient
                  colors={[Stage.nightSoft, Stage.violet]}
                  style={StyleSheet.absoluteFill}
                />
              )}
              {index === 0 ? (
                <View style={styles.flame}>
                  <Flame size={10} color={Stage.goldInk} strokeWidth={2.4} fill={Stage.gold} />
                </View>
              ) : null}
            </View>

            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={1}>
                {contest.title}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>{statusKicker(contest.status)}</Text>
                {contest.contestantCount > 0 ? (
                  <>
                    <Text style={styles.dot}>·</Text>
                    <Users size={10} color={Stage.muted} strokeWidth={2} />
                    <Text style={styles.meta}>{contest.contestantCount}</Text>
                  </>
                ) : null}
                {votes !== null ? (
                  <>
                    <Text style={styles.dot}>·</Text>
                    <Text style={styles.votes}>{formatVoteCount(votes)} votes</Text>
                  </>
                ) : null}
              </View>
            </View>

            <ChevronRight size={16} color={Stage.muted} strokeWidth={2.2} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Stage.card,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Stage.hairline,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Stage.hairline,
  },
  pressed: { backgroundColor: Stage.paper },
  rank: {
    ...Typography.headlineMd,
    fontSize: 19,
    lineHeight: 22,
    fontWeight: '800' as const,
    letterSpacing: -1,
    color: 'rgba(52,0,117,0.18)',
    width: 30,
  },
  thumb: {
    width: 50,
    height: 50,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Stage.nightSoft,
  },
  flame: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 16,
    height: 16,
    borderRadius: Radius.full,
    backgroundColor: Stage.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  title: {
    ...Typography.labelMd,
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '700' as const,
    color: Stage.ink,
    marginBottom: 3,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  meta: { ...Typography.caption, fontSize: 10.5, lineHeight: 13, color: Stage.muted },
  dot: { fontSize: 10.5, color: Stage.hairline },
  votes: {
    ...Typography.caption,
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '700' as const,
    color: Stage.goldText,
  },
});
