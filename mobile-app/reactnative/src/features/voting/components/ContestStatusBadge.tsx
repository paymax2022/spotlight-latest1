import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Radio } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { VotingColors } from '../constants/voting.constants';
import type { ContestStatus } from '../types/voting.types';

const CONFIG: Record<ContestStatus, { label: string; color: string; bg: string; pulse?: boolean }> = {
  LIVE:              { label: 'Live',     color: VotingColors.contestLive,     bg: VotingColors.contestLiveBg,     pulse: true },
  UPCOMING:          { label: 'Upcoming', color: VotingColors.contestUpcoming,  bg: VotingColors.contestUpcomingBg },
  PAUSED:            { label: 'Paused',   color: VotingColors.contestPaused,    bg: VotingColors.contestPausedBg },
  CLOSED:            { label: 'Closed',   color: VotingColors.contestClosed,    bg: VotingColors.contestClosedBg },
  RESULTS_PUBLISHED: { label: 'Results',  color: VotingColors.contestClosed,    bg: VotingColors.contestClosedBg },
};

interface Props {
  status: ContestStatus;
  size?: 'sm' | 'md';
}

export default function ContestStatusBadge({ status, size = 'md' }: Props) {
  const { label, color, bg, pulse } = CONFIG[status] ?? CONFIG.CLOSED;
  const isSmall = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: bg }, isSmall && styles.badgeSm]}>
      {pulse ? (
        <Radio size={isSmall ? 8 : 10} color={color} strokeWidth={2} />
      ) : (
        <View style={[styles.dot, { backgroundColor: color }, isSmall && styles.dotSm]} />
      )}
      <Text style={[styles.label, { color }, isSmall && styles.labelSm]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            4,
    paddingVertical:   4,
    paddingHorizontal: 10,
    borderRadius:   Radius.full,
  },
  badgeSm: { paddingVertical: 2, paddingHorizontal: 7 },
  dot:   { width: 6, height: 6, borderRadius: 3 },
  dotSm: { width: 5, height: 5, borderRadius: 2.5 },
  label:   { ...Typography.labelSm, fontSize: 12, fontWeight: '700' as const },
  labelSm: { fontSize: 10 },
});
