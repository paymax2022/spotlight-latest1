import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GraduationCap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatPoints } from '../utils/spotlightFormatters';
import type { LeaderboardEntry } from '../types/spotlight.types';

interface Props {
  entry: LeaderboardEntry;
  highlight?: boolean;   // emphasise the current user's row
}

/**
 * Learning-leaderboard row. Shows LEARNING points (lessons/quizzes) — never
 * profit. Top three ranks get a subtle accent badge; no money is displayed.
 */
export default function LeaderboardRow({ entry, highlight }: Props) {
  const top3 = entry.rank <= 3;
  return (
    <View style={[styles.row, highlight && styles.highlightRow]}>
      <View style={[styles.rankBadge, top3 && styles.rankBadgeTop]}>
        <Text style={[styles.rankText, top3 && styles.rankTextTop]}>{entry.rank}</Text>
      </View>
      <Text style={[styles.name, highlight && styles.nameHighlight]} numberOfLines={1}>
        {entry.displayName}
      </Text>
      <View style={styles.pointsWrap}>
        <GraduationCap size={13} color={Colors.teal} strokeWidth={2} />
        <Text style={styles.points}>{formatPoints(entry.points)} pts</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  highlightRow: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    marginHorizontal: -Spacing.sm,
  },
  rankBadge: {
    width: 30, height: 30, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center',
  },
  rankBadgeTop: { backgroundColor: Colors.iconBgGold },
  rankText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  rankTextTop: { color: Colors.onWarning },
  name: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  nameHighlight: { color: Colors.primary },
  pointsWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  points: { ...Typography.labelMd, color: Colors.onSurface },
});
