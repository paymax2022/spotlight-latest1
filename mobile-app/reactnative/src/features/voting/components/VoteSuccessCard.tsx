import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CheckCircle2, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { VotingColors } from '../constants/voting.constants';
import { formatVoteCount } from '../utils/voteFormatters';
import ContestantImage from './ContestantImage';

interface Props {
  contestantName: string;
  contestantPhoto?: string;
  votesCast: number;
  newRank?: number;
  newVoteTotal?: number;
}

export default function VoteSuccessCard({ contestantName, contestantPhoto, votesCast, newRank, newVoteTotal }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.successIcon}>
        <CheckCircle2 size={52} color={VotingColors.contestLive} strokeWidth={1.5} />
      </View>
      <Text style={styles.title}>Votes Counted!</Text>
      <Text style={styles.sub}>Your vote for{'\n'}<Text style={styles.name}>{contestantName}</Text>{'\n'}has been recorded.</Text>

      {/* Nothing is painted when there is no renderable photo, which is what this
          card already did for an empty value. The change is that a root-relative
          reader path now counts as renderable: before, the browser asked Metro for
          /api/v1/contestants/<id>/photo and the ring showed on its own. */}
      <ContestantImage value={contestantPhoto} style={styles.photo} accessibilityLabel={contestantName} />

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>+{votesCast}</Text>
          <Text style={styles.statLabel}>Votes Cast</Text>
        </View>
        {newRank != null && (
          <View style={styles.stat}>
            <View style={styles.rankRow}>
              <TrendingUp size={14} color={VotingColors.contestLive} strokeWidth={2} />
              <Text style={[styles.statValue, { color: VotingColors.contestLive }]}>#{newRank}</Text>
            </View>
            <Text style={styles.statLabel}>Current Rank</Text>
          </View>
        )}
        {newVoteTotal != null && (
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatVoteCount(newVoteTotal)}</Text>
            <Text style={styles.statLabel}>Total Votes</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card:       { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
  successIcon: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', backgroundColor: VotingColors.contestLiveBg, borderRadius: 40 },
  title:      { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 26 },
  name:       { color: Colors.primary, fontWeight: '700' as const },
  photo:      { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: VotingColors.contestLive },
  statsRow:   { flexDirection: 'row', gap: Spacing.xl },
  stat:       { alignItems: 'center', gap: 4 },
  rankRow:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue:  { ...Typography.titleLg, color: Colors.onSurface, fontWeight: '700' as const },
  statLabel:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
