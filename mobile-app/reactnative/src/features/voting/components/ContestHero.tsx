import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ContestStatusBadge from './ContestStatusBadge';
import CountdownTimer from './CountdownTimer';
import { formatVoteCount } from '../utils/voteFormatters';
import type { Contest } from '../types/voting.types';

interface Props {
  contest: Contest;
  height?: number;
}

export default function ContestHero({ contest, height = 260 }: Props) {
  return (
    <View style={[styles.wrap, { height }]}>
      {contest.bannerImage ? (
        <Image source={{ uri: contest.bannerImage }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.placeholder]} />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(11,28,48,0.92)']}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.content}>
        <ContestStatusBadge status={contest.status} />
        <Text style={styles.title}>{contest.title}</Text>
        <Text style={styles.category}>{contest.category}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{contest.contestantCount}</Text>
            <Text style={styles.statLabel}>Contestants</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatVoteCount(contest.totalVotes)}</Text>
            <Text style={styles.statLabel}>Total Votes</Text>
          </View>
          {contest.status === 'LIVE' && contest.endsAt && (
            <>
              <View style={styles.divider} />
              <View style={styles.stat}>
                <CountdownTimer endsAt={contest.endsAt} size="sm" color={Colors.white} />
                <Text style={styles.statLabel}>Remaining</Text>
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:        { position: 'relative', borderRadius: Radius.xl, overflow: 'hidden' },
  image:       { ...StyleSheet.absoluteFillObject },
  placeholder: { backgroundColor: Colors.primaryContainer },
  content: {
    position:    'absolute',
    bottom:      0,
    left:        0,
    right:       0,
    padding:     Spacing.lg,
    gap:         6,
  },
  title:    { ...Typography.headlineLgMobile, color: Colors.white, marginTop: 6 },
  category: { ...Typography.labelSm, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.8 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: 4 },
  stat:     { alignItems: 'center', gap: 2 },
  statValue: { ...Typography.labelLg, color: Colors.white, fontWeight: '700' as const },
  statLabel: { ...Typography.caption, color: 'rgba(255,255,255,0.65)' },
  divider:  { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.25)' },
});
