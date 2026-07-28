import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Users, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import {
  formatNaira,
  formatNairaCompact,
  progressPct,
  deadlineLabel,
} from '../utils/crowdfundingFormatters';

interface Props {
  raisedKobo: number;
  goalKobo: number;
  contributorCount: number;
  deadline: string | null;
  compact?: boolean;          // card vs. detail-page sizing
}

/** Funding progress bar + raised/goal/contributors/days-left stats. */
export default function CampaignProgress({
  raisedKobo,
  goalKobo,
  contributorCount,
  deadline,
  compact,
}: Props) {
  const pct = progressPct(raisedKobo, goalKobo);
  const fmt = compact ? formatNairaCompact : (k: number) => formatNaira(k);

  return (
    <View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>

      <View style={styles.amountRow}>
        <Text style={[styles.raised, compact && styles.raisedCompact]}>
          {fmt(raisedKobo)}
          <Text style={styles.raisedSub}>  raised</Text>
        </Text>
        <Text style={styles.pct}>{pct}%</Text>
      </View>

      {!compact && (
        <Text style={styles.goal}>of {formatNaira(goalKobo)} goal</Text>
      )}

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Users size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.statText}>
            {contributorCount.toLocaleString('en-NG')} {contributorCount === 1 ? 'backer' : 'backers'}
          </Text>
        </View>
        <View style={styles.stat}>
          <Clock size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.statText}>{deadlineLabel(deadline)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
    backgroundColor: Colors.teal,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: Spacing.sm,
  },
  raised: { ...Typography.titleLg, color: Colors.onSurface },
  raisedCompact: { ...Typography.titleMd },
  raisedSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '400' as const },
  pct: { ...Typography.labelMd, color: Colors.teal },
  goal: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
