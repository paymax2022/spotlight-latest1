import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Crown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import type { Tier, TierId } from '../types';

interface Props {
  tier: Pick<Tier, 'name' | 'color'> & { id?: TierId };
  size?: 'sm' | 'md';
}

export default function TierBadge({ tier, size = 'md' }: Props) {
  const small = size === 'sm';
  return (
    <View style={[styles.badge, { backgroundColor: tier.color }, small && styles.badgeSm]}>
      <Crown size={small ? 12 : 14} color={Colors.white} strokeWidth={2.2} />
      <Text style={[styles.text, small && styles.textSm]}>{tier.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full },
  badgeSm: { paddingHorizontal: 8, paddingVertical: 3, gap: 3 },
  text: { ...Typography.labelMd, color: Colors.white, fontWeight: '700' as const },
  textSm: { ...Typography.labelSm, color: Colors.white, fontWeight: '700' as const },
});
