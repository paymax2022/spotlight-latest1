import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Users, Vote, Calendar } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import ContestStatusBadge from './ContestStatusBadge';
import CountdownTimer from './CountdownTimer';
import { formatVoteCount, formatContestPeriod } from '../utils/voteFormatters';
import type { Contest } from '../types/voting.types';

interface Props {
  contest: Contest;
  onPress: () => void;
  style?: object;
}

export default function ContestCard({ contest, onPress, style }: Props) {
  const period = formatContestPeriod(contest.startsAt, contest.endsAt);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed, style]}
    >
      <View style={styles.imageWrap}>
        {contest.bannerImage ? (
          <Image source={{ uri: contest.bannerImage }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imagePlaceholder} />
        )}
        <View style={styles.badgePos}>
          <ContestStatusBadge status={contest.status} size="sm" />
        </View>
        {contest.sponsorName && (
          <View style={styles.sponsorPill}>
            <Text style={styles.sponsorText}>by {contest.sponsorName}</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.categoryRow}>
          <Text style={styles.category}>{contest.category}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>{contest.title}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Users size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.statText}>{contest.contestantCount} contestants</Text>
          </View>
          <View style={styles.stat}>
            <Vote size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.statText}>{formatVoteCount(contest.totalVotes)} votes</Text>
          </View>
        </View>

        {period && (
          <View style={styles.periodRow}>
            <Calendar size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.statText}>{period}</Text>
          </View>
        )}

        {contest.status === 'LIVE' && contest.endsAt && (
          <View style={styles.footer}>
            <Text style={styles.endsLabel}>Ends in</Text>
            <CountdownTimer endsAt={contest.endsAt} size="sm" color={Colors.primary} />
          </View>
        )}
        {contest.status === 'UPCOMING' && contest.startsAt && (
          <View style={styles.footer}>
            <Text style={styles.endsLabel}>Starts</Text>
            <Text style={styles.startDate}>
              {new Date(contest.startsAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
            </Text>
          </View>
        )}
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
  },
  pressed:     { opacity: 0.88 },
  imageWrap:   { position: 'relative', height: 140 },
  image:       { width: '100%', height: '100%' },
  imagePlaceholder: { width: '100%', height: '100%', backgroundColor: Colors.surfaceContainerHigh },
  badgePos:    { position: 'absolute', top: Spacing.sm, left: Spacing.sm },
  sponsorPill: {
    position:        'absolute', bottom: Spacing.sm, right: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderRadius:    Radius.full,
  },
  sponsorText: { ...Typography.caption, color: Colors.white },
  body: { padding: Spacing.md },
  categoryRow: { marginBottom: 4 },
  category:    { ...Typography.caption, color: Colors.primary, fontWeight: '600' as const, textTransform: 'uppercase', letterSpacing: 0.5 },
  title:       { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  statsRow:    { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.sm },
  stat:        { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  periodRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: Spacing.sm },
  footer:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 4 },
  endsLabel:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  startDate:   { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' as const },
});
