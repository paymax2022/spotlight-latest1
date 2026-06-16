import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Gift } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { VotingColors } from '../constants/voting.constants';

interface Props {
  remaining: number;
  total?: number;
  size?: 'sm' | 'md';
}

export default function FreeVoteBadge({ remaining, total, size = 'md' }: Props) {
  const isSm = size === 'sm';
  const empty = remaining === 0;

  return (
    <View style={[styles.badge, empty && styles.empty, isSm && styles.sm]}>
      <Gift size={isSm ? 12 : 14} color={empty ? '#94A3B8' : VotingColors.freeVote} strokeWidth={2} />
      <Text style={[styles.text, empty && styles.textEmpty, isSm && styles.textSm]}>
        {empty
          ? 'No free votes left'
          : `${remaining}${total ? `/${total}` : ''} free ${remaining === 1 ? 'vote' : 'votes'}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            5,
    paddingVertical:   5,
    paddingHorizontal: 10,
    borderRadius:   Radius.full,
    backgroundColor: VotingColors.freeVoteBg,
  },
  empty:    { backgroundColor: '#F1F5F9' },
  sm:       { paddingVertical: 3, paddingHorizontal: 8 },
  text:     { ...Typography.labelSm, color: VotingColors.freeVote, fontWeight: '600' as const },
  textEmpty: { color: '#94A3B8' },
  textSm:   { fontSize: 11 },
});
