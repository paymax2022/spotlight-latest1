import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { VotingColors } from '../constants/voting.constants';

interface Props {
  rank: number;
  size?: 'sm' | 'md' | 'lg';
  /** When false (admin hid ranks), render nothing. Defaults to visible. */
  show?: boolean;
}

function getRankStyle(rank: number) {
  if (rank === 1) return { bg: VotingColors.podiumGoldBg,   color: VotingColors.rankGold };
  if (rank === 2) return { bg: VotingColors.podiumSilverBg, color: VotingColors.rankSilver };
  if (rank === 3) return { bg: VotingColors.podiumBronzeBg, color: VotingColors.rankBronze };
  return { bg: Colors.surfaceContainerHigh, color: Colors.onSurfaceVariant };
}

export default function RankBadge({ rank, size = 'md', show = true }: Props) {
  if (!show) return null;
  const { bg, color } = getRankStyle(rank);
  const isLg = size === 'lg';
  const isSm = size === 'sm';

  return (
    <View style={[
      styles.badge,
      { backgroundColor: bg },
      isLg && styles.lg,
      isSm && styles.sm,
    ]}>
      <Text style={[styles.text, { color }, isLg && styles.textLg, isSm && styles.textSm]}>
        #{rank}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth:    32,
    height:      28,
    borderRadius: Radius.md,
    alignItems:  'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  lg: { minWidth: 44, height: 36, borderRadius: Radius.lg },
  sm: { minWidth: 24, height: 22, borderRadius: Radius.sm, paddingHorizontal: 5 },
  text:   { ...Typography.labelMd, fontWeight: '700' as const },
  textLg: { fontSize: 16 },
  textSm: { fontSize: 11 },
});
