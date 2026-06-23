import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { VotingColors } from '../constants/voting.constants';
import { Colors } from '@/constants/colors';

interface Props {
  movement?: 'UP' | 'DOWN' | 'SAME';
  previousRank?: number;
  currentRank?: number;
}

export default function RankMovementBadge({ movement = 'SAME', previousRank, currentRank }: Props) {
  const diff = previousRank && currentRank ? Math.abs(previousRank - currentRank) : undefined;

  if (movement === 'UP') {
    return (
      <View style={[styles.badge, styles.up]}>
        <TrendingUp size={11} color={VotingColors.contestLive} strokeWidth={2.5} />
        {diff ? <Text style={[styles.text, { color: VotingColors.contestLive }]}>+{diff}</Text> : null}
      </View>
    );
  }

  if (movement === 'DOWN') {
    return (
      <View style={[styles.badge, styles.down]}>
        <TrendingDown size={11} color={Colors.error} strokeWidth={2.5} />
        {diff ? <Text style={[styles.text, { color: Colors.error }]}>-{diff}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.badge, styles.same]}>
      <Minus size={11} color={Colors.onSurfaceVariant} strokeWidth={2.5} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge:  { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Radius.full },
  up:     { backgroundColor: VotingColors.contestLiveBg },
  down:   { backgroundColor: Colors.errorContainer },
  same:   { backgroundColor: Colors.surfaceContainerHigh },
  text:   { ...Typography.caption, fontWeight: '700' as const },
});
