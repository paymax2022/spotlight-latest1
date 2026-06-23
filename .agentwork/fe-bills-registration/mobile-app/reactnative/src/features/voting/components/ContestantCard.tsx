import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { MapPin, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import RankBadge from './RankBadge';
import VoteButton from './VoteButton';
import RankMovementBadge from './RankMovementBadge';
import { formatVoteCount } from '../utils/voteFormatters';
import type { Contestant } from '../types/voting.types';

interface Props {
  contestant: Contestant;
  onPress: () => void;
  onVote: () => void;
  isVoting?: boolean;
}

export default function ContestantCard({ contestant, onPress, onVote, isVoting }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={styles.imageWrap}>
        {contestant.photo ? (
          <Image source={{ uri: contestant.photo }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.photoPlaceholder]}>
            <Text style={styles.placeholderInitial}>
              {(contestant.stageName ?? contestant.name).charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.rankPos}>
          <RankBadge rank={contestant.rank} size="sm" />
        </View>
        <View style={styles.movementPos}>
          <RankMovementBadge movement={contestant.movement} />
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.stageName} numberOfLines={1}>
            {contestant.stageName ?? contestant.name}
          </Text>
          {contestant.isVerified && (
            <BadgeCheck size={14} color={Colors.secondary} fill={Colors.secondary} strokeWidth={0} />
          )}
        </View>
        <Text style={styles.realName} numberOfLines={1}>{contestant.name}</Text>

        {(contestant.state || contestant.category) && (
          <View style={styles.infoRow}>
            {contestant.state && (
              <>
                <MapPin size={11} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.infoText}>{contestant.state}</Text>
              </>
            )}
            {contestant.category && contestant.state && <Text style={styles.dot}>·</Text>}
            {contestant.category && <Text style={styles.infoText}>{contestant.category}</Text>}
          </View>
        )}

        <Text style={styles.votes}>{formatVoteCount(contestant.votes)} votes</Text>

        <VoteButton onPress={onVote} label="Vote" variant="primary" size="sm" loading={isVoting} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius:    Radius.xl,
    overflow:        'hidden',
    borderWidth:     1,
    borderColor:     Colors.surfaceContainerHigh,
    flex:            1,
  },
  pressed:          { opacity: 0.88 },
  imageWrap:        { position: 'relative', height: 160 },
  image:            { width: '100%', height: '100%' },
  photoPlaceholder: { backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  placeholderInitial: { ...Typography.headlineMd, color: Colors.onPrimaryContainer },
  rankPos:          { position: 'absolute', top: Spacing.sm, left: Spacing.sm },
  movementPos:      { position: 'absolute', top: Spacing.sm, right: Spacing.sm },
  body:             { padding: Spacing.sm, gap: 3 },
  nameRow:          { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stageName:        { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  realName:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  infoRow:          { flexDirection: 'row', alignItems: 'center', gap: 3, marginVertical: 2 },
  infoText:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  dot:              { ...Typography.caption, color: Colors.outlineVariant },
  votes:            { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const, marginBottom: 6 },
});
