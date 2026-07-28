import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { CheckCircle2, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { VotingColors } from '../constants/voting.constants';
import { formatVoteCount } from '../utils/voteFormatters';

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

      {contestantPhoto && (
        <Image source={{ uri: contestantPhoto }} style={styles.photo} />
      )}

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
