import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import RankBadge from './RankBadge';
import RankMovementBadge from './RankMovementBadge';
import VoteButton from './VoteButton';
import { formatVoteCount } from '../utils/voteFormatters';
import type { LeaderboardEntry } from '../types/voting.types';

interface Props {
  entry: LeaderboardEntry;
  onPress: () => void;
  onVote: () => void;
  isVoting?: boolean;
}

export default function LeaderboardRow({ entry, onPress, onVote, isVoting }: Props) {
  const { contestant, rank, movement, previousRank, rankChange } = entry;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <RankBadge rank={rank} size="md" />

      <View style={styles.avatarWrap}>
        {contestant.photo ? (
          <Image source={{ uri: contestant.photo }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitial}>
              {(contestant.stageName ?? contestant.name).charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        {contestant.isVerified && (
          <View style={styles.verifiedDot}>
            <BadgeCheck size={12} color={Colors.secondary} fill={Colors.secondary} strokeWidth={0} />
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {contestant.stageName ?? contestant.name}
        </Text>
        <Text style={styles.votes}>{formatVoteCount(contestant.votes)} votes</Text>
      </View>

      <View style={styles.right}>
        <RankMovementBadge movement={movement} rankChange={rankChange} previousRank={previousRank} currentRank={rank} />
        <VoteButton onPress={onVote} label="Vote" size="sm" variant="outline" loading={isVoting} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  pressed:   { opacity: 0.78 },
  avatarWrap: { position: 'relative' },
  avatar:    { width: 44, height: 44, borderRadius: Radius.full },
  avatarPlaceholder: { backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...Typography.labelMd, color: Colors.onPrimaryContainer },
  verifiedDot: {
    position:        'absolute',
    bottom:          -2,
    right:           -2,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius:    Radius.full,
  },
  info:  { flex: 1, gap: 2 },
  name:  { ...Typography.labelMd, color: Colors.onSurface },
  votes: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});
