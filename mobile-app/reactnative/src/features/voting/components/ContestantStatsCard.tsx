import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Eye, Share2, Vote, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { formatVoteCount } from '../utils/voteFormatters';
import type { Contestant } from '../types/voting.types';

interface Props {
  contestant: Contestant;
}

function StatItem({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <View style={styles.statItem}>
      <View style={[styles.statIcon, { backgroundColor: color + '18' }]}>
        <Icon size={16} color={color} strokeWidth={2} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function ContestantStatsCard({ contestant }: Props) {
  return (
    <View style={[styles.card, shadow1]}>
      <Text style={styles.heading}>Campaign Stats</Text>
      <View style={styles.grid}>
        <StatItem icon={Vote}     label="Total Votes"   value={formatVoteCount(contestant.votes)}              color={Colors.primary} />
        <StatItem icon={TrendingUp} label="Current Rank" value={`#${contestant.rank}`}                         color={Colors.secondary} />
        <StatItem icon={Eye}      label="Profile Views" value={formatVoteCount(contestant.profileViews ?? 0)}  color={Colors.teal} />
        <StatItem icon={Share2}   label="Share Clicks"  value={formatVoteCount(contestant.shareClicks ?? 0)}   color='#F59E0B' />
      </View>
      {contestant.votesNeededToNextRank != null && contestant.votesNeededToNextRank > 0 && (
        <View style={styles.progressRow}>
          <Text style={styles.progressLabel}>
            {formatVoteCount(contestant.votesNeededToNextRank)} more votes to reach #{contestant.rank - 1}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius:    Radius.xl,
    padding:         Spacing.lg,
    borderWidth:     1,
    borderColor:     Colors.surfaceContainerHigh,
    gap:             Spacing.md,
  },
  heading:   { ...Typography.titleMd, color: Colors.onSurface },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  statItem:  { flex: 1, minWidth: '44%', alignItems: 'center', gap: 4 },
  statIcon:  { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  progressRow: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius:    Radius.md,
    padding:         Spacing.sm,
    alignItems:      'center',
  },
  progressLabel: { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' as const },
});
