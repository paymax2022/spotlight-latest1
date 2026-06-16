import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShoppingCart } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Colors } from '@/constants/colors';
import { VotingColors } from '../constants/voting.constants';

interface Props {
  label?: string;
  size?: 'sm' | 'md';
}

export default function PaidVoteBadge({ label = 'Buy votes', size = 'md' }: Props) {
  const isSm = size === 'sm';
  return (
    <View style={[styles.badge, isSm && styles.sm]}>
      <ShoppingCart size={isSm ? 12 : 14} color={Colors.secondary} strokeWidth={2} />
      <Text style={[styles.text, isSm && styles.textSm]}>{label}</Text>
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
    backgroundColor: VotingColors.paidVoteBg,
  },
  sm:      { paddingVertical: 3, paddingHorizontal: 8 },
  text:    { ...Typography.labelSm, color: Colors.secondary, fontWeight: '600' as const },
  textSm:  { fontSize: 11 },
});
